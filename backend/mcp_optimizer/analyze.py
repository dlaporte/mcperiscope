"""Deep analysis of MCP tool definitions and evaluation traces.

Combines static analysis (tool definitions only) with trace-based analysis
(from evaluation runs) to produce structured, prioritised optimisation
recommendations.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from itertools import combinations
from typing import Any

from mcp.types import Tool

from backend.mcp_optimizer.inventory import estimate_tokens, levenshtein


# ---------------------------------------------------------------------------
# Static analysis — tool definitions only
# ---------------------------------------------------------------------------


def analyze_token_budget(tools: list[Tool]) -> list[dict[str, Any]]:
    """Ranked table of per-tool token cost (desc + schema).

    Returns a list sorted by total_tokens descending, each entry containing
    name, description_tokens, schema_tokens, total_tokens.
    """
    rows: list[dict[str, Any]] = []
    for tool in tools:
        desc_text = f"{tool.name}: {tool.description or ''}"
        schema_text = json.dumps(tool.inputSchema) if tool.inputSchema else ""
        desc_tok = estimate_tokens(desc_text)
        schema_tok = estimate_tokens(schema_text)
        rows.append({
            "name": tool.name,
            "description_tokens": desc_tok,
            "schema_tokens": schema_tok,
            "total_tokens": desc_tok + schema_tok,
        })
    rows.sort(key=lambda r: r["total_tokens"], reverse=True)
    return rows


def analyze_name_clarity(tools: list[Tool]) -> dict[str, Any]:
    """Prefix clusters, Levenshtein pairs < 3, and ambiguous naming flags."""
    # Prefix clusters
    prefix_groups: dict[str, list[str]] = {}
    for tool in tools:
        prefix = _extract_prefix(tool.name)
        prefix_groups.setdefault(prefix, []).append(tool.name)

    clusters = [
        {"prefix": prefix, "tools": sorted(names), "count": len(names)}
        for prefix, names in prefix_groups.items()
        if len(names) >= 2
    ]
    clusters.sort(key=lambda c: (-c["count"], c["prefix"]))

    # Levenshtein pairs with distance < 3
    similar_pairs: list[dict[str, Any]] = []
    names = [t.name for t in tools]
    for a, b in combinations(names, 2):
        if abs(len(a) - len(b)) > 2:
            continue
        dist = levenshtein(a, b)
        if 0 < dist < 3:
            similar_pairs.append({"tool_a": a, "tool_b": b, "distance": dist})
    similar_pairs.sort(key=lambda p: (p["distance"], p["tool_a"]))

    # Ambiguous naming: single-word names, very short names, generic names
    generic_words = {"run", "do", "get", "set", "execute", "process", "handle", "data"}
    ambiguous: list[dict[str, str]] = []
    for tool in tools:
        name_lower = tool.name.lower()
        if len(tool.name) <= 3:
            ambiguous.append({"name": tool.name, "reason": "very short name (<=3 chars)"})
        elif name_lower in generic_words:
            ambiguous.append({"name": tool.name, "reason": "overly generic name"})
        elif "_" not in tool.name and not re.search(r"[A-Z]", tool.name[1:]):
            # Single-word name with no separators
            if len(tool.name) < 10:
                ambiguous.append({"name": tool.name, "reason": "single-word name, may lack specificity"})

    return {
        "prefix_clusters": clusters,
        "similar_pairs": similar_pairs,
        "ambiguous_names": ambiguous,
    }


_CAMEL_BOUNDARY = re.compile(r"(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])")


def _extract_prefix(name: str) -> str:
    """Return the first logical word of a tool name."""
    if "_" in name:
        return name.split("_", 1)[0].lower()
    parts = _CAMEL_BOUNDARY.split(name)
    if parts:
        return parts[0].lower()
    return name.lower()


def analyze_descriptions(tools: list[Tool]) -> list[dict[str, Any]]:
    """Score each tool description 0-10 on specificity, disambiguation,
    return-value clarity, and length appropriateness."""
    results: list[dict[str, Any]] = []
    tool_names = [t.name for t in tools]

    for tool in tools:
        desc = tool.description or ""
        scores: dict[str, int] = {}

        # --- Specificity (0-10) ---
        specificity = 5
        # Reward action verbs at the start
        action_verbs = {"retrieves", "creates", "updates", "deletes", "searches",
                        "lists", "fetches", "sends", "validates", "generates",
                        "computes", "calculates", "converts", "parses", "extracts"}
        first_word = desc.split()[0].lower() if desc.strip() else ""
        if first_word in action_verbs:
            specificity += 2
        # Reward mentioning specific nouns / entities
        if re.search(r"\b(user|file|record|document|message|event|item|order|account)\b", desc, re.I):
            specificity += 1
        # Penalise vague language
        vague_phrases = ["does stuff", "handles things", "tool for", "a tool", "this tool"]
        for phrase in vague_phrases:
            if phrase in desc.lower():
                specificity -= 2
        if not desc.strip():
            specificity = 0
        scores["specificity"] = max(0, min(10, specificity))

        # --- Disambiguation (0-10) ---
        disambiguation = 5
        # Check if description mentions how it differs from similar tools
        similar_names = [n for n in tool_names if n != tool.name and _extract_prefix(n) == _extract_prefix(tool.name)]
        if similar_names:
            # Has sibling tools — check if description distinguishes
            words_in_desc = set(desc.lower().split())
            # Check for contrasting language
            contrast_words = {"unlike", "instead", "rather", "specifically", "only",
                              "exclusively", "whereas", "but not", "distinct"}
            if words_in_desc & contrast_words:
                disambiguation += 3
            # Check if it mentions what it does NOT do
            if "not" in words_in_desc or "without" in words_in_desc:
                disambiguation += 1
            # If sibling tools exist but no distinguishing language, penalise
            if not (words_in_desc & contrast_words) and "not" not in words_in_desc:
                disambiguation -= 2
        else:
            # No siblings, disambiguation is less relevant — default OK
            disambiguation = 7
        if not desc.strip():
            disambiguation = 0
        scores["disambiguation"] = max(0, min(10, disambiguation))

        # --- Return value clarity (0-10) ---
        return_clarity = 5
        return_keywords = {"returns", "responds", "outputs", "produces", "yields",
                           "result", "response", "output"}
        desc_lower = desc.lower()
        if any(kw in desc_lower for kw in return_keywords):
            return_clarity += 3
        # Mention of data types / structure
        if re.search(r"\b(list|array|object|string|number|boolean|json|dict|map|id)\b", desc_lower):
            return_clarity += 2
        if not desc.strip():
            return_clarity = 0
        scores["return_value_clarity"] = max(0, min(10, return_clarity))

        # --- Length appropriateness (0-10) ---
        length = len(desc)
        if length == 0:
            length_score = 0
        elif length < 20:
            length_score = 3  # too terse
        elif length <= 500:
            length_score = 10  # ideal range
        elif length <= 800:
            length_score = 6  # getting verbose
        else:
            length_score = 3  # too verbose
        scores["length_appropriateness"] = length_score

        # Overall
        overall = round(sum(scores.values()) / len(scores), 1)

        results.append({
            "name": tool.name,
            "description_length": length,
            "scores": scores,
            "overall_score": overall,
            "issues": _description_issues(desc, scores),
        })

    results.sort(key=lambda r: r["overall_score"])
    return results


def _description_issues(desc: str, scores: dict[str, int]) -> list[str]:
    """Generate human-readable issue list based on scores."""
    issues: list[str] = []
    if not desc.strip():
        issues.append("Missing description entirely")
        return issues
    if scores.get("specificity", 10) < 4:
        issues.append("Description lacks specificity — use concrete action verbs and nouns")
    if scores.get("disambiguation", 10) < 4:
        issues.append("Does not distinguish from similarly-named tools")
    if scores.get("return_value_clarity", 10) < 4:
        issues.append("Does not describe what is returned")
    if len(desc) < 20:
        issues.append("Description is too terse (<20 chars)")
    if len(desc) > 500:
        issues.append("Description is too verbose (>500 chars)")
    return issues


def analyze_schema_overlap(tools: list[Tool]) -> list[dict[str, Any]]:
    """Find tools with identical or near-identical parameter schemas.

    Near-identical means they share >80% of their required + optional
    parameters by name and type.
    """
    results: list[dict[str, Any]] = []

    def _param_fingerprint(schema: dict[str, Any] | None) -> dict[str, str]:
        """Extract {param_name: type} from a JSON Schema."""
        if not schema:
            return {}
        props = schema.get("properties", {})
        return {
            name: prop.get("type", "unknown")
            for name, prop in props.items()
        }

    tool_params = [(t.name, _param_fingerprint(t.inputSchema)) for t in tools]

    for (name_a, params_a), (name_b, params_b) in combinations(tool_params, 2):
        if not params_a and not params_b:
            continue
        all_keys = set(params_a.keys()) | set(params_b.keys())
        if not all_keys:
            continue

        # Identical check
        identical = params_a == params_b and bool(params_a)
        # Overlap check
        shared = set(params_a.keys()) & set(params_b.keys())
        matching_types = sum(1 for k in shared if params_a[k] == params_b[k])
        overlap_ratio = matching_types / len(all_keys) if all_keys else 0.0

        if identical:
            results.append({
                "tools": [name_a, name_b],
                "overlap": "identical",
                "overlap_ratio": 1.0,
                "shared_params": sorted(shared),
                "consolidation_candidate": True,
            })
        elif overlap_ratio >= 0.8:
            results.append({
                "tools": [name_a, name_b],
                "overlap": "near_identical",
                "overlap_ratio": round(overlap_ratio, 2),
                "shared_params": sorted(shared),
                "only_in_a": sorted(set(params_a.keys()) - set(params_b.keys())),
                "only_in_b": sorted(set(params_b.keys()) - set(params_a.keys())),
                "consolidation_candidate": True,
            })

    results.sort(key=lambda r: -r["overlap_ratio"])
    return results


def analyze_lookup_tools(tools: list[Tool]) -> list[dict[str, Any]]:
    """Identify lookup / reference / list tools that return static data.

    These are candidates for embedding into system prompts or caching.
    """
    lookup_keywords = {"lookup", "list", "get", "fetch", "reference", "describe",
                       "info", "metadata", "schema", "enum", "values", "options",
                       "categories", "types", "status", "statuses"}
    static_indicators = {"static", "constant", "fixed", "predefined", "enum",
                         "reference data", "lookup table", "does not change",
                         "cached", "read-only"}

    results: list[dict[str, Any]] = []
    for tool in tools:
        name_lower = tool.name.lower()
        desc_lower = (tool.description or "").lower()
        name_words = set(re.split(r"[_\-]", name_lower)) | set(_CAMEL_BOUNDARY.split(name_lower))

        is_lookup = bool(name_words & lookup_keywords)
        is_static = any(indicator in desc_lower for indicator in static_indicators)

        # Check if tool takes no required params or only simple ID params
        schema = tool.inputSchema or {}
        required = set(schema.get("required", []))
        props = schema.get("properties", {})
        param_count = len(props)
        simple_params = param_count <= 1

        # Check if description suggests read-only / retrieval
        read_verbs = {"retrieves", "returns", "gets", "fetches", "lists", "shows",
                      "displays", "looks up", "provides"}
        desc_suggests_read = any(verb in desc_lower for verb in read_verbs)

        confidence = 0.0
        reasons: list[str] = []
        if is_lookup:
            confidence += 0.3
            reasons.append("Name contains lookup/list/reference keyword")
        if is_static:
            confidence += 0.4
            reasons.append("Description indicates static/reference data")
        if simple_params:
            confidence += 0.15
            reasons.append(f"Simple parameter signature ({param_count} params)")
        if desc_suggests_read:
            confidence += 0.15
            reasons.append("Description suggests read-only operation")

        if confidence >= 0.3:
            results.append({
                "name": tool.name,
                "confidence": round(min(1.0, confidence), 2),
                "reasons": reasons,
                "embedding_candidate": confidence >= 0.5,
                "param_count": param_count,
            })

    results.sort(key=lambda r: -r["confidence"])
    return results


# ---------------------------------------------------------------------------
# Trace analysis — from evaluation traces + ratings
# ---------------------------------------------------------------------------


def _group_traces_by_prompt(traces: list[dict]) -> list[list[dict]]:
    """Group traces into per-prompt evaluation runs.

    Uses the 'step' field: each time step resets to 0 (or decreases),
    we start a new group.
    """
    if not traces:
        return []

    groups: list[list[dict]] = []
    current: list[dict] = [traces[0]]

    for trace in traces[1:]:
        if trace.get("step", 0) <= current[-1].get("step", -1) and trace.get("step", 0) == 0:
            groups.append(current)
            current = [trace]
        else:
            current.append(trace)

    if current:
        groups.append(current)
    return groups


def find_confusion_pairs(traces: list[dict]) -> list[dict[str, Any]]:
    """Find sequences where tool A errors, then tool B is called (wrong-then-correct)."""
    groups = _group_traces_by_prompt(traces)
    pair_counts: Counter[tuple[str, str]] = Counter()
    pair_examples: dict[tuple[str, str], list[dict]] = defaultdict(list)

    for group in groups:
        for i in range(len(group) - 1):
            current = group[i]
            next_trace = group[i + 1]
            if current.get("error_category") is not None:
                pair = (current["tool_name"], next_trace["tool_name"])
                pair_counts[pair] += 1
                if len(pair_examples[pair]) < 3:
                    pair_examples[pair].append({
                        "failed_tool": current["tool_name"],
                        "failed_input": current.get("tool_input"),
                        "error": current.get("error_category"),
                        "next_tool": next_trace["tool_name"],
                        "next_input": next_trace.get("tool_input"),
                    })

    results: list[dict[str, Any]] = []
    for (tool_a, tool_b), count in pair_counts.most_common():
        if tool_a != tool_b:  # Only interesting when different tools
            results.append({
                "confused_tool": tool_a,
                "correct_tool": tool_b,
                "occurrences": count,
                "examples": pair_examples[(tool_a, tool_b)],
            })

    return results


def find_redundant_calls(traces: list[dict]) -> list[dict[str, Any]]:
    """Find cases where the same tool is called with same/similar args in one eval run."""
    groups = _group_traces_by_prompt(traces)
    redundancies: list[dict[str, Any]] = []

    for group_idx, group in enumerate(groups):
        seen: dict[str, list[dict]] = defaultdict(list)
        for trace in group:
            tool_name = trace["tool_name"]
            tool_input = trace.get("tool_input", {})
            input_key = json.dumps(tool_input, sort_keys=True)

            for prev in seen[tool_name]:
                prev_key = json.dumps(prev.get("tool_input", {}), sort_keys=True)
                if input_key == prev_key:
                    redundancies.append({
                        "prompt_group": group_idx,
                        "tool_name": tool_name,
                        "input": tool_input,
                        "match_type": "exact_duplicate",
                        "wasted_tokens": trace.get("tool_response_tokens_est", 0),
                    })
                    break
                elif _inputs_similar(tool_input, prev.get("tool_input", {})):
                    redundancies.append({
                        "prompt_group": group_idx,
                        "tool_name": tool_name,
                        "input": tool_input,
                        "previous_input": prev.get("tool_input"),
                        "match_type": "similar_arguments",
                        "wasted_tokens": trace.get("tool_response_tokens_est", 0),
                    })
                    break

            seen[tool_name].append(trace)

    # Aggregate
    summary: dict[str, dict[str, Any]] = {}
    for r in redundancies:
        key = r["tool_name"]
        if key not in summary:
            summary[key] = {
                "tool_name": key,
                "total_redundant_calls": 0,
                "total_wasted_tokens": 0,
                "match_types": Counter(),
                "examples": [],
            }
        summary[key]["total_redundant_calls"] += 1
        summary[key]["total_wasted_tokens"] += r.get("wasted_tokens", 0)
        summary[key]["match_types"][r["match_type"]] += 1
        if len(summary[key]["examples"]) < 3:
            summary[key]["examples"].append(r)

    results = []
    for entry in summary.values():
        entry["match_types"] = dict(entry["match_types"])
        results.append(entry)
    results.sort(key=lambda r: -r["total_wasted_tokens"])
    return results


def _inputs_similar(a: dict, b: dict) -> bool:
    """Check if two tool inputs are similar (>70% key overlap with same values)."""
    if not a or not b:
        return False
    all_keys = set(a.keys()) | set(b.keys())
    if not all_keys:
        return False
    matching = sum(1 for k in all_keys if k in a and k in b and a[k] == b[k])
    return matching / len(all_keys) >= 0.7


def find_parameter_hops(traces: list[dict]) -> list[dict[str, Any]]:
    """Detect chains where tool A output values appear in tool B inputs (ID passing)."""
    groups = _group_traces_by_prompt(traces)
    hop_counts: Counter[tuple[str, str]] = Counter()
    hop_fields: dict[tuple[str, str], Counter[str]] = defaultdict(Counter)
    hop_examples: dict[tuple[str, str], list[dict]] = defaultdict(list)

    for group in groups:
        for i, trace_a in enumerate(group):
            response_fields = trace_a.get("tool_response_fields", [])
            if not response_fields:
                continue
            # Collect output values from tool A: look for field names appearing
            # as input values in subsequent calls
            for trace_b in group[i + 1:]:
                tool_input = trace_b.get("tool_input", {})
                if not tool_input:
                    continue
                # Check if any input value matches a response field name pattern
                # (the actual value from tool A appearing in tool B input)
                input_values = _flatten_values(tool_input)
                for field_name in response_fields:
                    # Check if the field name appears as an input parameter name
                    # or if input values reference fields from the response
                    for param_name, param_val in tool_input.items():
                        # Field name from response used as parameter name in input
                        if param_name == field_name or (
                            isinstance(param_val, str) and field_name in param_val
                        ):
                            pair = (trace_a["tool_name"], trace_b["tool_name"])
                            hop_counts[pair] += 1
                            hop_fields[pair][field_name] += 1
                            if len(hop_examples[pair]) < 3:
                                hop_examples[pair].append({
                                    "source_tool": trace_a["tool_name"],
                                    "source_field": field_name,
                                    "target_tool": trace_b["tool_name"],
                                    "target_param": param_name,
                                })
                            break
                    else:
                        continue
                    break

    results: list[dict[str, Any]] = []
    for (tool_a, tool_b), count in hop_counts.most_common():
        results.append({
            "source_tool": tool_a,
            "target_tool": tool_b,
            "hop_count": count,
            "fields_passed": dict(hop_fields[(tool_a, tool_b)].most_common()),
            "examples": hop_examples[(tool_a, tool_b)],
            "batch_candidate": count >= 3,
        })

    return results


def _flatten_values(d: dict) -> list[Any]:
    """Recursively extract all leaf values from a dict."""
    values: list[Any] = []
    for v in d.values():
        if isinstance(v, dict):
            values.extend(_flatten_values(v))
        elif isinstance(v, list):
            for item in v:
                if isinstance(item, dict):
                    values.extend(_flatten_values(item))
                else:
                    values.append(item)
        else:
            values.append(v)
    return values


def compute_error_cost(traces: list[dict]) -> dict[str, Any]:
    """Total tokens wasted on error paths."""
    error_traces = [t for t in traces if t.get("error_category") is not None]
    total_wasted = sum(t.get("tool_response_tokens_est", 0) for t in error_traces)

    by_category: dict[str, dict[str, Any]] = {}
    for t in error_traces:
        cat = t["error_category"]
        if cat not in by_category:
            by_category[cat] = {"count": 0, "tokens_wasted": 0, "tools": Counter()}
        by_category[cat]["count"] += 1
        by_category[cat]["tokens_wasted"] += t.get("tool_response_tokens_est", 0)
        by_category[cat]["tools"][t["tool_name"]] += 1

    # Convert counters for serialisation
    for cat_info in by_category.values():
        cat_info["tools"] = dict(cat_info["tools"].most_common())

    by_tool: Counter[str] = Counter()
    tokens_by_tool: Counter[str] = Counter()
    for t in error_traces:
        by_tool[t["tool_name"]] += 1
        tokens_by_tool[t["tool_name"]] += t.get("tool_response_tokens_est", 0)

    return {
        "total_error_calls": len(error_traces),
        "total_tokens_wasted": total_wasted,
        "by_category": by_category,
        "by_tool": [
            {"tool": name, "error_count": count, "tokens_wasted": tokens_by_tool[name]}
            for name, count in by_tool.most_common()
        ] if by_tool else [],
    }


def find_sequence_patterns(traces: list[dict]) -> list[dict[str, Any]]:
    """N-gram analysis of tool_name sequences. Tools called together >60% of time
    are consolidation candidates."""
    groups = _group_traces_by_prompt(traces)
    if not groups:
        return []

    # Count bigrams and trigrams
    bigram_counts: Counter[tuple[str, ...]] = Counter()
    trigram_counts: Counter[tuple[str, ...]] = Counter()
    tool_counts: Counter[str] = Counter()

    for group in groups:
        names = [t["tool_name"] for t in group]
        for name in names:
            tool_counts[name] += 1
        for i in range(len(names) - 1):
            bigram_counts[(names[i], names[i + 1])] += 1
        for i in range(len(names) - 2):
            trigram_counts[(names[i], names[i + 1], names[i + 2])] += 1

    total_groups = len(groups)
    results: list[dict[str, Any]] = []

    # Analyse bigrams
    for bigram, count in bigram_counts.most_common():
        # Frequency: how many groups contain this bigram / total groups
        groups_with_bigram = sum(
            1 for group in groups
            if _contains_subsequence([t["tool_name"] for t in group], list(bigram))
        )
        frequency = groups_with_bigram / total_groups if total_groups > 0 else 0
        if frequency >= 0.3:  # Report at 30%+ for visibility
            results.append({
                "pattern": list(bigram),
                "pattern_type": "bigram",
                "occurrences": count,
                "frequency": round(frequency, 2),
                "groups_present": groups_with_bigram,
                "total_groups": total_groups,
                "consolidation_candidate": frequency >= 0.6,
            })

    # Analyse trigrams
    for trigram, count in trigram_counts.most_common():
        groups_with_trigram = sum(
            1 for group in groups
            if _contains_subsequence([t["tool_name"] for t in group], list(trigram))
        )
        frequency = groups_with_trigram / total_groups if total_groups > 0 else 0
        if frequency >= 0.3:
            results.append({
                "pattern": list(trigram),
                "pattern_type": "trigram",
                "occurrences": count,
                "frequency": round(frequency, 2),
                "groups_present": groups_with_trigram,
                "total_groups": total_groups,
                "consolidation_candidate": frequency >= 0.6,
            })

    results.sort(key=lambda r: (-r["frequency"], -r["occurrences"]))
    return results


def _contains_subsequence(sequence: list[str], subseq: list[str]) -> bool:
    """Check if subseq appears as a contiguous subsequence in sequence."""
    n = len(subseq)
    return any(sequence[i:i + n] == subseq for i in range(len(sequence) - n + 1))


def analyze_correctness_correlation(
    traces: list[dict], ratings: list[dict]
) -> list[dict[str, Any]]:
    """Which tools appear more in wrong-answer vs correct-answer traces."""
    groups = _group_traces_by_prompt(traces)

    # Map prompt_index to correctness
    correctness_map: dict[int, str] = {}
    for rating in ratings:
        correctness_map[rating["prompt_index"]] = rating.get("correctness", "unknown")

    # Count tool usage in correct vs incorrect groups
    tool_correct: Counter[str] = Counter()
    tool_incorrect: Counter[str] = Counter()
    total_correct = 0
    total_incorrect = 0

    for idx, group in enumerate(groups):
        correctness = correctness_map.get(idx, "unknown")
        if correctness == "correct":
            total_correct += 1
            for trace in group:
                tool_correct[trace["tool_name"]] += 1
        elif correctness in ("incorrect", "wrong"):
            total_incorrect += 1
            for trace in group:
                tool_incorrect[trace["tool_name"]] += 1

    all_tools = set(tool_correct.keys()) | set(tool_incorrect.keys())
    results: list[dict[str, Any]] = []

    for tool_name in all_tools:
        correct_count = tool_correct.get(tool_name, 0)
        incorrect_count = tool_incorrect.get(tool_name, 0)
        total_uses = correct_count + incorrect_count

        # Rate: how much more frequently does this tool appear in incorrect traces?
        correct_rate = correct_count / total_correct if total_correct > 0 else 0
        incorrect_rate = incorrect_count / total_incorrect if total_incorrect > 0 else 0

        if incorrect_rate > correct_rate and incorrect_count > 0:
            error_bias = round(incorrect_rate - correct_rate, 3)
        else:
            error_bias = 0.0

        results.append({
            "tool_name": tool_name,
            "uses_in_correct": correct_count,
            "uses_in_incorrect": incorrect_count,
            "total_uses": total_uses,
            "correct_rate": round(correct_rate, 3),
            "incorrect_rate": round(incorrect_rate, 3),
            "error_bias": error_bias,
        })

    results.sort(key=lambda r: -r["error_bias"])
    return results


# ---------------------------------------------------------------------------
# Recommendation generation
# ---------------------------------------------------------------------------


def generate_recommendations(
    static: dict[str, Any],
    trace_analysis: dict[str, Any],
    tools: list[Tool],
) -> list[dict[str, Any]]:
    """Combine all analysis results into a prioritised list of recommendations."""
    recommendations: list[dict[str, Any]] = []
    rec_id = 0

    tool_map = {t.name: t for t in tools}
    budget_by_name = {b["name"]: b for b in static.get("token_budget", [])}

    def _next_id() -> str:
        nonlocal rec_id
        rec_id += 1
        return f"rec_{rec_id:03d}"

    # --- From name clarity: prefix clusters with 4+ tools ---
    for cluster in static.get("name_clarity", {}).get("prefix_clusters", []):
        if cluster["count"] >= 4:
            source_tools = cluster["tools"]
            savings = sum(
                budget_by_name.get(n, {}).get("total_tokens", 0)
                for n in source_tools[1:]
            )
            recommendations.append({
                "id": _next_id(),
                "type": "consolidate",
                "impact": _impact_level(savings),
                "source_tools": source_tools,
                "target_tool": {
                    "name": cluster["prefix"],
                    "parameters": _merged_params(source_tools, tool_map),
                    "description": f"Unified {cluster['prefix']} operation (replaces {cluster['count']} tools)",
                },
                "estimated_token_savings": savings,
                "risk": "LOW",
                "evidence": (
                    f"{cluster['count']} tools share the '{cluster['prefix']}' prefix "
                    f"and could be consolidated into a single parameterised tool"
                ),
                "description": (
                    f"Consolidate {cluster['count']} {cluster['prefix']}_* tools "
                    f"into 1 parameterized tool"
                ),
            })

    # --- From schema overlap: identical schemas with 3+ tools ---
    # Group overlapping tools into clusters to avoid combinatorial explosion.
    # Only recommend clusters with 3+ tools (pairs are too granular).
    seen_overlap_tools: set[str] = set()
    for overlap in static.get("schema_overlap", []):
        source_tools = overlap["tools"]
        if len(source_tools) < 3:
            continue
        # Skip if these tools are already covered by a prefix cluster
        key = frozenset(source_tools)
        if key & seen_overlap_tools:
            continue
        seen_overlap_tools.update(source_tools)
        savings = sum(
            budget_by_name.get(n, {}).get("total_tokens", 0)
            for n in source_tools[1:]
        )
        if savings > 0:
            recommendations.append({
                "id": _next_id(),
                "type": "consolidate",
                "impact": _impact_level(savings),
                "source_tools": source_tools,
                "target_tool": {
                    "name": _common_name(source_tools),
                    "parameters": _merged_params(source_tools, tool_map),
                    "description": f"Unified tool replacing {', '.join(source_tools[:5])}{'...' if len(source_tools) > 5 else ''}",
                },
                "estimated_token_savings": savings,
                "risk": "LOW",
                "evidence": (
                    f"{len(source_tools)} tools share {overlap['overlap']} "
                    f"parameter schemas (overlap ratio: {overlap['overlap_ratio']})"
                ),
                "description": (
                    f"Merge {len(source_tools)} tools with {overlap['overlap']} schemas "
                    f"into a single tool"
                ),
            })

    # --- From descriptions: poor-scoring descriptions ---
    for desc_info in static.get("descriptions", []):
        if desc_info["overall_score"] < 4.0 and desc_info.get("issues"):
            recommendations.append({
                "id": _next_id(),
                "type": "rewrite_description",
                "impact": "MEDIUM",
                "source_tools": [desc_info["name"]],
                "target_tool": None,
                "estimated_token_savings": 0,
                "risk": "LOW",
                "evidence": (
                    f"Description scored {desc_info['overall_score']}/10. "
                    f"Issues: {'; '.join(desc_info['issues'])}"
                ),
                "description": (
                    f"Rewrite description for '{desc_info['name']}' to improve "
                    f"LLM tool selection accuracy"
                ),
            })

    # --- From lookup tools: aggregate into one consolidation rec ---
    lookup_candidates = [
        l for l in static.get("lookup_tools", [])
        if l.get("embedding_candidate") and l.get("confidence", 0) >= 0.5
    ]
    if len(lookup_candidates) >= 3:
        source_tools = [l["name"] for l in lookup_candidates]
        savings = sum(
            budget_by_name.get(n, {}).get("total_tokens", 0)
            for n in source_tools[1:]  # keep 1 tool's worth
        )
        recommendations.append({
            "id": _next_id(),
            "type": "consolidate",
            "impact": _impact_level(savings),
            "source_tools": source_tools,
            "target_tool": {
                "name": "lookup",
                "parameters": {"table": {"type": "string", "enum": source_tools}},
                "description": f"Consolidated lookup for {len(source_tools)} reference/static data tools",
            },
            "estimated_token_savings": savings,
            "risk": "LOW",
            "evidence": (
                f"{len(source_tools)} tools appear to return reference/static data "
                f"and could be consolidated into a single parameterized lookup tool"
            ),
            "description": (
                f"Consolidate {len(source_tools)} lookup/reference tools into 1 "
                f"parameterized tool"
            ),
        })

    # --- From token budget: oversized tools (top 5 only) ---
    oversized = [b for b in static.get("token_budget", []) if b["total_tokens"] > 300]
    for budget in oversized[:5]:
            recommendations.append({
                "id": _next_id(),
                "type": "trim_response",
                "impact": "MEDIUM",
                "source_tools": [budget["name"]],
                "target_tool": None,
                "estimated_token_savings": budget["total_tokens"] - 400,
                "risk": "LOW",
                "evidence": (
                    f"Tool '{budget['name']}' consumes {budget['total_tokens']} tokens "
                    f"in the menu (schema: {budget['schema_tokens']}, "
                    f"description: {budget['description_tokens']})"
                ),
                "description": (
                    f"Reduce schema/description size for '{budget['name']}' "
                    f"to save ~{budget['total_tokens'] - 400} tokens"
                ),
            })

    # --- From trace analysis ---

    # Sequence patterns -> consolidation (top 5 only to avoid noise)
    for pattern in trace_analysis.get("sequence_patterns", [])[:5]:
        if pattern.get("consolidation_candidate"):
            source_tools = pattern["pattern"]
            savings = sum(
                budget_by_name.get(n, {}).get("total_tokens", 0)
                for n in source_tools[1:]
            )
            recommendations.append({
                "id": _next_id(),
                "type": "consolidate",
                "impact": _impact_level(savings),
                "source_tools": source_tools,
                "target_tool": {
                    "name": _common_name(source_tools),
                    "parameters": _merged_params(source_tools, tool_map),
                    "description": f"Combined operation replacing sequence {' -> '.join(source_tools)}",
                },
                "estimated_token_savings": savings,
                "risk": "MEDIUM",
                "evidence": (
                    f"Called together in {pattern['frequency'] * 100:.0f}% of traces "
                    f"({pattern['groups_present']}/{pattern['total_groups']} evaluation runs)"
                ),
                "description": (
                    f"Consolidate {len(source_tools)} tools commonly called in sequence "
                    f"({' -> '.join(source_tools)})"
                ),
            })

    # Parameter hops -> batch
    for hop in trace_analysis.get("parameter_hops", []):
        if hop.get("batch_candidate"):
            source_tools = [hop["source_tool"], hop["target_tool"]]
            savings = estimate_tokens(json.dumps(
                tool_map[hop["source_tool"]].inputSchema
            )) if hop["source_tool"] in tool_map and tool_map[hop["source_tool"]].inputSchema else 0
            recommendations.append({
                "id": _next_id(),
                "type": "batch",
                "impact": _impact_level(savings),
                "source_tools": source_tools,
                "target_tool": None,
                "estimated_token_savings": savings,
                "risk": "MEDIUM",
                "evidence": (
                    f"'{hop['source_tool']}' output is passed to '{hop['target_tool']}' "
                    f"in {hop['hop_count']} instances. "
                    f"Fields: {', '.join(hop['fields_passed'].keys())}"
                ),
                "description": (
                    f"Create batch/chained endpoint combining "
                    f"'{hop['source_tool']}' -> '{hop['target_tool']}'"
                ),
            })

    # Redundant calls -> add_defaults or caching
    for redundancy in trace_analysis.get("redundant_calls", []):
        if redundancy["total_redundant_calls"] >= 2:
            recommendations.append({
                "id": _next_id(),
                "type": "add_defaults",
                "impact": _impact_level(redundancy["total_wasted_tokens"]),
                "source_tools": [redundancy["tool_name"]],
                "target_tool": None,
                "estimated_token_savings": redundancy["total_wasted_tokens"],
                "risk": "LOW",
                "evidence": (
                    f"'{redundancy['tool_name']}' called redundantly "
                    f"{redundancy['total_redundant_calls']} times, "
                    f"wasting ~{redundancy['total_wasted_tokens']} tokens. "
                    f"Types: {redundancy['match_types']}"
                ),
                "description": (
                    f"Add caching or defaults for '{redundancy['tool_name']}' "
                    f"to reduce redundant calls"
                ),
            })

    # Confusion pairs -> rewrite descriptions
    for confusion in trace_analysis.get("confusion_pairs", []):
        if confusion["occurrences"] >= 2:
            recommendations.append({
                "id": _next_id(),
                "type": "rewrite_description",
                "impact": "HIGH",
                "source_tools": [confusion["confused_tool"], confusion["correct_tool"]],
                "target_tool": None,
                "estimated_token_savings": 0,
                "risk": "LOW",
                "evidence": (
                    f"LLM chose '{confusion['confused_tool']}' (which errored) before "
                    f"'{confusion['correct_tool']}' in {confusion['occurrences']} cases — "
                    f"descriptions likely need clarification"
                ),
                "description": (
                    f"Rewrite descriptions for '{confusion['confused_tool']}' and "
                    f"'{confusion['correct_tool']}' to reduce confusion"
                ),
            })

    # Error cost -> tools with high error rates
    error_cost = trace_analysis.get("error_cost", {})
    for tool_error in error_cost.get("by_tool", []):
        if tool_error.get("error_count", 0) >= 3:
            recommendations.append({
                "id": _next_id(),
                "type": "rewrite_description",
                "impact": "MEDIUM",
                "source_tools": [tool_error["tool"]],
                "target_tool": None,
                "estimated_token_savings": tool_error.get("tokens_wasted", 0),
                "risk": "LOW",
                "evidence": (
                    f"'{tool_error['tool']}' errored {tool_error['error_count']} times, "
                    f"wasting {tool_error.get('tokens_wasted', 0)} tokens"
                ),
                "description": (
                    f"Improve '{tool_error['tool']}' description/schema to reduce "
                    f"error rate"
                ),
            })

    # Deduplicate: if same source_tools appear in multiple recs, keep highest impact
    recommendations = _deduplicate_recommendations(recommendations)
    # Sort by impact
    impact_order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    recommendations.sort(key=lambda r: (impact_order.get(r["impact"], 3), -r["estimated_token_savings"]))

    return recommendations


def _impact_level(savings: int) -> str:
    """Map token savings to impact level."""
    if savings >= 1000:
        return "HIGH"
    elif savings >= 300:
        return "MEDIUM"
    return "LOW"


def _common_name(tool_names: list[str]) -> str:
    """Derive a common name from a list of tool names."""
    if not tool_names:
        return "unified_tool"
    prefixes = [_extract_prefix(n) for n in tool_names]
    most_common = Counter(prefixes).most_common(1)
    if most_common:
        return most_common[0][0]
    return tool_names[0].split("_")[0] if "_" in tool_names[0] else tool_names[0]


def _merged_params(tool_names: list[str], tool_map: dict[str, Tool]) -> dict[str, Any]:
    """Merge parameter schemas from multiple tools into one."""
    all_properties: dict[str, Any] = {}
    all_required: set[str] = set()

    for name in tool_names:
        tool = tool_map.get(name)
        if not tool or not tool.inputSchema:
            continue
        props = tool.inputSchema.get("properties", {})
        required = set(tool.inputSchema.get("required", []))
        for param_name, param_schema in props.items():
            if param_name not in all_properties:
                all_properties[param_name] = param_schema
        # Only keep required if required in ALL tools
        if not all_required:
            all_required = required
        else:
            all_required &= required

    # Add an "action" or "type" discriminator if merging distinct tools
    if len(tool_names) > 1:
        all_properties["action"] = {
            "type": "string",
            "enum": tool_names,
            "description": "Which operation to perform",
        }
        all_required.add("action")

    result: dict[str, Any] = {"type": "object", "properties": all_properties}
    if all_required:
        result["required"] = sorted(all_required)
    return result


def _deduplicate_recommendations(recs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Remove duplicate recommendations targeting the same tools with same type."""
    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for rec in recs:
        key = f"{rec['type']}:{','.join(sorted(rec['source_tools']))}"
        if key not in seen:
            seen.add(key)
            deduped.append(rec)
    return deduped


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


def run_analysis(
    tools: list[Tool],
    traces: list[dict],
    ratings: list[dict],
) -> dict:
    """Run full deep analysis on tool definitions and evaluation traces.

    Args:
        tools: MCP tool definitions.
        traces: Evaluation trace events (may be empty).
        ratings: Correctness ratings per prompt (may be empty).

    Returns:
        Dict with ``static_analysis``, ``trace_analysis``, and
        ``recommendations`` keys.
    """
    # --- Static analysis (always runs) ---
    static = {
        "token_budget": analyze_token_budget(tools),
        "name_clarity": analyze_name_clarity(tools),
        "descriptions": analyze_descriptions(tools),
        "schema_overlap": analyze_schema_overlap(tools),
        "lookup_tools": analyze_lookup_tools(tools),
    }

    # --- Trace analysis (only if traces provided) ---
    trace_result: dict[str, Any] = {}
    if traces:
        trace_result["confusion_pairs"] = find_confusion_pairs(traces)
        trace_result["redundant_calls"] = find_redundant_calls(traces)
        trace_result["parameter_hops"] = find_parameter_hops(traces)
        trace_result["error_cost"] = compute_error_cost(traces)
        trace_result["sequence_patterns"] = find_sequence_patterns(traces)
        if ratings:
            trace_result["correctness_correlation"] = analyze_correctness_correlation(
                traces, ratings
            )

    # --- Recommendations ---
    recommendations = generate_recommendations(static, trace_result, tools)

    return {
        "static_analysis": static,
        "trace_analysis": trace_result,
        "recommendations": recommendations,
    }
