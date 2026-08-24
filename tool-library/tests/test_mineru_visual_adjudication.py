from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import sys
import unittest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from mineru_visual_adjudication import (  # noqa: E402
    VISUAL_ADJUDICATION_CONTRACT,
    VISUAL_ADJUDICATION_SCHEMA_VERSION,
    VISUAL_CANDIDATE_SCHEMA_VERSION,
    build_visual_candidates,
    canonical_sha256,
    validate_visual_adjudication,
    validate_visual_candidates,
)


def detection_summary(
    figure_key: str | None = None,
    *,
    formal: bool = False,
    next_page: bool = False,
    terminal: bool = True,
) -> dict[str, object]:
    figure_keys = [figure_key] if figure_key else []
    formal_keys = [figure_key] if figure_key and formal else []
    return {
        "char_count": 80,
        "item_count": 1,
        "figure_keys": figure_keys,
        "leading_figure_key": figure_key,
        "formal_figure_caption_keys": formal_keys,
        "leading_formal_figure_caption_key": figure_key if formal else None,
        "next_page_marker": next_page,
        "next_page_figure_keys": figure_keys if next_page else [],
        "next_page_reference_count": 1 if next_page else 0,
        "starts_with_lowercase": False,
        "starts_with_panel_label": False,
        "ends_with_terminal_punctuation": terminal,
        # This field simulates prose that must never enter the AI candidate packet.
        "text": "SECRET PAPER BODY THAT MUST NOT BE EXPORTED",
    }


def block(
    block_id: str,
    page_order: int,
    role: str,
    bbox: list[int],
    *,
    caption: dict[str, object] | None = None,
    text: dict[str, object] | None = None,
) -> dict[str, object]:
    value: dict[str, object] = {
        "id": block_id,
        "source_index": page_order,
        "page_order": page_order,
        "source_type": "image" if role == "visual" else "text",
        "role": role,
        "bbox_norm": bbox,
        "asset_path": f"images/{block_id}.png" if role == "visual" else None,
        "markdown_image_ids": [],
    }
    if caption is not None:
        value["caption"] = caption
    if text is not None:
        value["text"] = text
    return value


def fixture_contracts() -> tuple[dict[str, object], dict[str, object]]:
    article_hash = "a" * 64
    mineru_hash = "b" * 64
    inputs = {
        "article": {"path": "article.md", "sha256": article_hash},
        "mineru_result": {"path": "mineru-result.json", "sha256": mineru_hash},
    }
    viewer = {
        "schema_version": 1,
        "status": "complete",
        "inputs": inputs,
        "markdown_images": [],
        "pages": [
            {
                "page_idx": 0,
                "blocks": [
                    block(
                        "p0000-s000001",
                        0,
                        "visual",
                        [60, 100, 430, 420],
                        caption=detection_summary(),
                    ),
                    block(
                        "p0000-s000002",
                        1,
                        "visual",
                        [440, 100, 820, 420],
                        caption=detection_summary(),
                    ),
                    block(
                        "p0000-s000003",
                        2,
                        "visual",
                        [80, 500, 900, 850],
                        caption=detection_summary(
                            "figure:2", next_page=True, terminal=True
                        ),
                    ),
                ],
            },
            {
                "page_idx": 1,
                "blocks": [
                    block(
                        "p0001-s000001",
                        0,
                        "text",
                        [70, 60, 470, 280],
                        text=detection_summary(
                            "figure:2", formal=True, terminal=False
                        ),
                    )
                ],
            },
            {
                "page_idx": 2,
                "blocks": [
                    block(
                        "p0002-s000001",
                        0,
                        "visual",
                        [80, 180, 900, 760],
                        caption=detection_summary(
                            "figure:3", next_page=True, terminal=True
                        ),
                    )
                ],
            },
            {
                "page_idx": 3,
                "blocks": [
                    block(
                        "p0003-s000001",
                        0,
                        "text",
                        [60, 50, 470, 250],
                        text=detection_summary("figure:3", formal=True),
                    ),
                    block(
                        "p0003-s000002",
                        1,
                        "text",
                        [520, 50, 930, 250],
                        text=detection_summary("figure:3", formal=True),
                    ),
                ],
            },
        ],
        "issues": [],
    }
    repair = {
        "schema_version": 1,
        "algorithm_version": "visual-repair-v1.4",
        "status": "complete",
        "inputs": inputs,
        "groups": [
            {
                "id": "vr-p0000-g0000",
                "page_idx": 0,
                "member_block_ids": ["p0000-s000001", "p0000-s000002"],
                "member_asset_paths": ["images/one.png", "images/two.png"],
                "member_markdown_image_ids": [],
                "caption_anchor_block_ids": [],
                "decision": "review",
                "confidence": 0.79,
                "replacement": {
                    "mode": "pdf_crop",
                    "bbox_norm": [60, 100, 820, 420],
                    "padding_norm": 6,
                },
                "signals": {
                    "member_count": 2,
                    "adjacent_pair_count": 1,
                    "markdown_references_contiguous": True,
                    "union_area_fraction": 0.24,
                    "untrusted_prose": "must be dropped",
                },
                "reason_codes": ["same_page_connected_visuals"],
                "warning_codes": ["insufficient_figure_anchor_evidence"],
                "fallback": "original_assets",
            },
            {
                "id": "vr-p0000-g9999",
                "page_idx": 0,
                "member_block_ids": ["p0000-s000001", "p0000-s000002"],
                "decision": "auto",
                "confidence": 0.95,
                "replacement": {"mode": "pdf_crop"},
                "signals": {},
            },
        ],
        "caption_links": [
            {
                "visual_block_id": "p0000-s000003",
                "caption_block_ids": ["p0001-s000001"],
                "source_page_idx": 0,
                "target_page_idx": 1,
                "figure_key": "figure:2",
                "relation": "next_page_figure_caption",
                "status": "partial",
            }
        ],
        "issues": [
            {
                "code": "partial_next_page_figure_caption",
                "visual_block_id": "p0000-s000003",
                "source_page_idx": 0,
                "target_page_idx": 1,
                "figure_key": "figure:2",
            },
            {
                "code": "ambiguous_next_page_figure_caption",
                "visual_block_id": "p0002-s000001",
                "source_page_idx": 2,
                "target_page_idx": 3,
                "figure_key": "figure:3",
                "candidate_count": 2,
            },
        ],
    }
    return viewer, repair


def response_for(
    candidates: dict[str, object],
    decisions: list[dict[str, object]],
    *,
    model_id: str = "provider/model-1",
    prompt_version: str = "visual-adjudication-v1",
) -> dict[str, object]:
    return {
        "schema_version": VISUAL_ADJUDICATION_SCHEMA_VERSION,
        "contract": VISUAL_ADJUDICATION_CONTRACT,
        "candidate_package_sha256": candidates["candidate_package_sha256"],
        "inputs": deepcopy(candidates["inputs"]),
        "model_id": model_id,
        "prompt_version": prompt_version,
        "decisions": decisions,
    }


def error_codes(result: dict[str, object]) -> list[str]:
    return [
        str(error["code"])
        for error in result.get("errors", [])
        if isinstance(error, dict) and "code" in error
    ]


class MineruVisualAdjudicationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.viewer, self.repair = fixture_contracts()
        self.candidates = build_visual_candidates(self.viewer, self.repair)

    def test_builds_only_review_partial_and_ambiguous_candidates(self) -> None:
        self.assertEqual(self.candidates["status"], "ready")
        candidates = self.candidates["candidates"]
        self.assertEqual(len(candidates), 4)
        self.assertEqual(
            [candidate["kind"] for candidate in candidates].count("fragment_group"),
            1,
        )
        self.assertEqual(
            [candidate["kind"] for candidate in candidates].count(
                "cross_page_caption"
            ),
            3,
        )
        states = [candidate["review_state"] for candidate in candidates]
        self.assertEqual(states.count("review"), 1)
        self.assertEqual(states.count("partial"), 1)
        self.assertEqual(states.count("ambiguous"), 2)

        rendered = json.dumps(self.candidates, ensure_ascii=False)
        self.assertNotIn("SECRET PAPER BODY", rendered)
        self.assertNotIn("asset_path", rendered)
        self.assertNotIn("untrusted_prose", rendered)
        self.assertEqual(
            self.candidates,
            build_visual_candidates(deepcopy(self.viewer), deepcopy(self.repair)),
        )
        self.assertEqual(
            self.candidates["candidate_package_sha256"],
            canonical_sha256(
                {
                    key: value
                    for key, value in self.candidates.items()
                    if key != "candidate_package_sha256"
                }
            ),
        )
        self.assertEqual(
            validate_visual_candidates(
                self.candidates, self.viewer, self.repair
            ),
            [],
        )

    def test_unknown_candidate_id_is_rejected_without_exception(self) -> None:
        payload = response_for(
            self.candidates,
            [
                {
                    "candidate_id": "fragment-does-not-exist",
                    "verdict": "accept",
                    "confidence": 0.99,
                }
            ],
        )
        result = validate_visual_adjudication(payload, self.candidates)
        self.assertEqual(result["status"], "invalid")
        self.assertEqual(result["decisions"], [])
        self.assertIn("unknown_candidate_id", error_codes(result))

    def test_input_hash_mismatch_invalidates_whole_response(self) -> None:
        candidate_id = self.candidates["candidates"][0]["candidate_id"]
        payload = response_for(
            self.candidates,
            [{"candidate_id": candidate_id, "verdict": "accept", "confidence": 0.95}],
        )
        payload["inputs"]["article"]["sha256"] = "c" * 64

        result = validate_visual_adjudication(payload, self.candidates)
        self.assertEqual(result["status"], "invalid")
        self.assertEqual(result["decisions"], [])
        self.assertIn("adjudication_input_hash_mismatch", error_codes(result))

    def test_candidate_validation_detects_changed_visual_repair(self) -> None:
        changed_repair = deepcopy(self.repair)
        changed_repair["algorithm_version"] = "visual-repair-v9"
        errors = validate_visual_candidates(
            self.candidates, self.viewer, changed_repair
        )
        self.assertIn(
            "candidate_input_hash_mismatch",
            [error["code"] for error in errors],
        )

    def test_repair_input_hashes_are_required_valid_and_equal_to_viewer(self) -> None:
        mutations = [
            (
                "visual_repair_article_hash_missing",
                lambda repair: repair["inputs"]["article"].pop("sha256"),
            ),
            (
                "visual_repair_article_hash_invalid",
                lambda repair: repair["inputs"]["article"].__setitem__(
                    "sha256", "not-a-sha256"
                ),
            ),
            (
                "visual_repair_mineru_result_hash_missing",
                lambda repair: repair["inputs"]["mineru_result"].pop("sha256"),
            ),
            (
                "visual_repair_mineru_result_hash_invalid",
                lambda repair: repair["inputs"]["mineru_result"].__setitem__(
                    "sha256", "not-a-sha256"
                ),
            ),
            (
                "article_hash_mismatch",
                lambda repair: repair["inputs"]["article"].__setitem__(
                    "sha256", "c" * 64
                ),
            ),
            (
                "mineru_result_hash_mismatch",
                lambda repair: repair["inputs"]["mineru_result"].__setitem__(
                    "sha256", "d" * 64
                ),
            ),
        ]
        for expected_issue, mutate in mutations:
            with self.subTest(issue=expected_issue):
                repair = deepcopy(self.repair)
                mutate(repair)
                candidates = build_visual_candidates(self.viewer, repair)
                self.assertEqual(candidates["status"], "invalid")
                self.assertEqual(candidates["candidates"], [])
                self.assertIn(expected_issue, candidates["issues"])
                self.assertEqual(
                    validate_visual_candidates(candidates, self.viewer, repair),
                    [],
                )

    def test_recomputed_public_hashes_cannot_hide_candidate_tampering(self) -> None:
        tampered = deepcopy(self.candidates)
        fragment = next(
            candidate
            for candidate in tampered["candidates"]
            if candidate["kind"] == "fragment_group"
        )
        fragment["evidence"]["member_geometry"][0]["bbox_norm"][0] += 1

        candidate_material = {
            key: value for key, value in fragment.items() if key != "candidate_id"
        }
        fragment["candidate_id"] = "fragment-" + canonical_sha256(
            {
                "schema_version": VISUAL_CANDIDATE_SCHEMA_VERSION,
                "inputs": tampered["inputs"],
                "candidate": candidate_material,
            }
        )[:24]
        tampered["candidate_package_sha256"] = canonical_sha256(
            {
                key: value
                for key, value in tampered.items()
                if key != "candidate_package_sha256"
            }
        )

        errors = validate_visual_candidates(tampered, self.viewer, self.repair)
        codes = [error["code"] for error in errors]
        self.assertIn("candidate_derivation_mismatch", codes)
        self.assertNotIn("candidate_id_mismatch", codes)
        self.assertNotIn("candidate_package_hash_mismatch", codes)

    def test_extra_coordinate_or_path_fields_are_rejected(self) -> None:
        candidate_id = self.candidates["candidates"][0]["candidate_id"]
        payload = response_for(
            self.candidates,
            [
                {
                    "candidate_id": candidate_id,
                    "verdict": "accept",
                    "confidence": 0.99,
                    "bbox_norm": [0, 0, 1000, 1000],
                    "asset_path": "images/injected.png",
                    "caption_text": "invented source prose",
                }
            ],
        )
        result = validate_visual_adjudication(payload, self.candidates)
        self.assertEqual(result["status"], "invalid")
        self.assertEqual(result["decisions"], [])
        self.assertIn("invalid_decision_fields", error_codes(result))

    def test_low_confidence_accept_is_dropped_but_abstain_is_valid(self) -> None:
        first = self.candidates["candidates"][0]["candidate_id"]
        second = self.candidates["candidates"][1]["candidate_id"]
        payload = response_for(
            self.candidates,
            [
                {"candidate_id": first, "verdict": "accept", "confidence": 0.5},
                {"candidate_id": second, "verdict": "abstain", "confidence": 0.1},
            ],
        )
        result = validate_visual_adjudication(payload, self.candidates)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(len(result["decisions"]), 1)
        self.assertEqual(result["decisions"][0]["verdict"], "abstain")
        self.assertFalse(result["decisions"][0]["actionable"])
        self.assertIn("accept_confidence_below_threshold", error_codes(result))

    def test_valid_accepts_support_fragment_and_caption_candidates(self) -> None:
        fragment = next(
            candidate
            for candidate in self.candidates["candidates"]
            if candidate["kind"] == "fragment_group"
        )
        caption = next(
            candidate
            for candidate in self.candidates["candidates"]
            if candidate["kind"] == "cross_page_caption"
            and candidate["review_state"] == "partial"
        )
        payload = response_for(
            self.candidates,
            [
                {
                    "candidate_id": fragment["candidate_id"],
                    "verdict": "accept",
                    "confidence": 0.93,
                },
                {
                    "candidate_id": caption["candidate_id"],
                    "verdict": "accept",
                    "confidence": 0.91,
                },
            ],
        )
        result = validate_visual_adjudication(
            payload,
            self.candidates,
            expected_model_id="provider/model-1",
            expected_prompt_version="visual-adjudication-v1",
        )
        self.assertEqual(result["status"], "valid")
        self.assertEqual(result["errors"], [])
        self.assertEqual(len(result["decisions"]), 2)
        self.assertTrue(all(item["actionable"] for item in result["decisions"]))

    def test_model_and_prompt_versions_are_required_and_can_be_pinned(self) -> None:
        candidate_id = self.candidates["candidates"][0]["candidate_id"]
        payload = response_for(
            self.candidates,
            [{"candidate_id": candidate_id, "verdict": "reject", "confidence": 0.4}],
            model_id="wrong/model",
            prompt_version="wrong-prompt",
        )
        result = validate_visual_adjudication(
            payload,
            self.candidates,
            expected_model_id="provider/model-1",
            expected_prompt_version="visual-adjudication-v1",
        )
        self.assertEqual(result["status"], "invalid")
        self.assertIn("model_id_mismatch", error_codes(result))
        self.assertIn("prompt_version_mismatch", error_codes(result))


if __name__ == "__main__":
    unittest.main()
