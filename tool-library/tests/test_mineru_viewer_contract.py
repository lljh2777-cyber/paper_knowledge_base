from __future__ import annotations

import sys
from pathlib import Path
import unittest


SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from mineru_viewer_contract import (  # noqa: E402
    build_viewer_index,
    build_visual_repair,
    extract_markdown_image_occurrences,
    find_enclosing_visuals,
    merge_nested_visual_repair_groups,
    normalize_bbox,
    validate_viewer_index,
    validate_visual_repair,
)


def build_index(
    payload: list[dict[str, object]], markdown: str, *, packaged_pdf: bool = True
) -> dict[str, object]:
    return build_viewer_index(
        payload,
        extract_markdown_image_occurrences(markdown),
        {"article": "a" * 64, "mineru_result": "b" * 64},
        packaged_source_pdf=packaged_pdf,
    )


class MineruViewerContractTests(unittest.TestCase):
    def test_normalize_bbox_requires_normalized_nonempty_rectangle(self) -> None:
        self.assertEqual(normalize_bbox([0, 1, 999, 1000]), [0, 1, 999, 1000])
        self.assertEqual(
            normalize_bbox([0.1, 0.2, 0.9, 0.8], scale_unit_interval=True),
            [100, 200, 900, 800],
        )
        self.assertIsNone(normalize_bbox([0, 1, 1001, 1000]))
        self.assertIsNone(normalize_bbox([5, 5, 5, 10]))
        self.assertIsNone(normalize_bbox([0, True, 10, 10]))

    def test_markdown_image_occurrences_preserve_duplicate_occurrence(self) -> None:
        markdown = (
            "![](images/a.jpg)\n"
            "<img src=\"images/b.jpg\">\n"
            "![again](images/a.jpg \"title\")\n"
        )
        images = extract_markdown_image_occurrences(markdown)

        self.assertEqual(
            [item["id"] for item in images],
            ["md-img-0000", "md-img-0001", "md-img-0002"],
        )
        self.assertEqual(
            [item["asset_path"] for item in images],
            ["images/a.jpg", "images/b.jpg", "images/a.jpg"],
        )
        self.assertEqual([item["occurrence"] for item in images], [0, 0, 1])

    def test_viewer_index_adapts_real_content_list_fields_and_missing_bbox(self) -> None:
        payload = [
            {
                "type": "text",
                "page_idx": 0,
                "bbox": [50, 80, 400, 120],
                "text": "Heading",
                "text_level": 1,
            },
            {
                "type": "table",
                "page_idx": 0,
                "bbox": [50, 140, 900, 500],
                "img_path": "images/table.jpg",
                "table_caption": ["Table caption"],
                "table_body": "<table></table>",
            },
            {
                "type": "equation",
                "page_idx": 1,
                "text": "x^2",
                "text_format": "latex",
            },
        ]
        viewer = build_index(payload, "![](images/table.jpg)\n", packaged_pdf=False)

        self.assertEqual(viewer["status"], "partial")
        self.assertEqual(viewer["coordinate_system"]["extent"], 1000)
        self.assertIsNone(viewer["pdf_source"]["packaged_path"])
        blocks = [block for page in viewer["pages"] for block in page["blocks"]]
        self.assertEqual([block["role"] for block in blocks], ["title", "table", "equation"])
        self.assertEqual(blocks[1]["markdown_image_ids"], ["md-img-0000"])
        self.assertIsNone(blocks[2]["bbox_norm"])
        self.assertEqual(validate_viewer_index(viewer), [])

    def test_viewer_index_adapts_page_nested_v2_content(self) -> None:
        payload = [
            [
                {
                    "type": "image",
                    "bbox": [0.1, 0.2, 0.9, 0.8],
                    "content": {
                        "image_source": {"path": "images/v2.jpg"},
                        "image_caption": [
                            {
                                "type": "text",
                                "content": "Fig. 2. A complete caption from nested content.",
                            }
                        ],
                    },
                }
            ],
            [
                {
                    "type": "paragraph",
                    "bbox": [100, 100, 900, 180],
                    "content": {"paragraph_content": "Body"},
                }
            ],
        ]

        viewer = build_index(payload, "![](images/v2.jpg)\n")

        self.assertEqual(viewer["status"], "complete")
        self.assertEqual(viewer["summary"]["page_count"], 2)
        image = viewer["pages"][0]["blocks"][0]
        self.assertEqual(image["bbox_norm"], [100, 200, 900, 800])
        self.assertEqual(image["asset_path"], "images/v2.jpg")
        self.assertEqual(image["caption"]["figure_anchor_count"], 1)
        self.assertEqual(validate_viewer_index(viewer), [])

    def test_caption_items_preserve_fig5_style_atoms_and_order(self) -> None:
        payload = [
            {
                "type": "chart",
                "page_idx": 7,
                "bbox": [65, 58, 942, 470],
                "img_path": "images/fig5.jpg",
                "chart_caption": [
                    "c",
                    "Fig. 5 | Metabolite discovery in mouse tissues ending with experimental",
                    "f",
                    "g",
                    "spectrum from mouse urine. f, As in c, but for another metabolite.",
                ],
            }
        ]

        viewer = build_index(payload, "![](images/fig5.jpg)\n")
        caption = viewer["pages"][0]["blocks"][0]["caption"]

        self.assertEqual(
            [item["index"] for item in caption["items"]],
            [0, 1, 2, 3, 4],
        )
        self.assertEqual(
            [item["text"] for item in caption["items"]],
            payload[0]["chart_caption"],
        )
        self.assertEqual(
            [item["kind"] for item in caption["items"]],
            [
                "panel-label",
                "formal-caption",
                "panel-label",
                "panel-label",
                "caption-continuation",
            ],
        )
        self.assertEqual(caption["items"][1]["figure_key"], "figure:5")
        self.assertNotIn("figure_key", caption["items"][0])
        self.assertEqual(caption["panel_label_count"], 3)
        self.assertEqual(caption["figure_anchor_count"], 1)
        self.assertNotIn("text", caption)
        self.assertEqual(validate_viewer_index(viewer), [])

    def test_caption_item_classification_handles_formal_variants_and_boundaries(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [50, 50, 950, 700],
                "img_path": "images/captions.jpg",
                "image_caption": [
                    "Fig. x | A caption introduced by a vertical bar.",
                    "Figure 1. A caption introduced by a period.",
                    "Fig. 2 | See next page for caption",
                    "Fig. 3 shows the result discussed in ordinary body prose.",
                    "c",
                    "c, panel description continues here.",
                    "candidate values were compared in the next sentence.",
                    "a–d",
                    "brief lower.",
                    "Figure 4. Caption continued on the next page.",
                    "Discussion continues on the next page.",
                    "Fig. 5 | See next page for caption and other prose.",
                    "q r Extended Data Fig. 6 | See next page for caption and trailing prose.",
                ],
            }
        ]

        viewer = build_index(payload, "![](images/captions.jpg)\n")
        items = viewer["pages"][0]["blocks"][0]["caption"]["items"]

        self.assertEqual(
            [item["kind"] for item in items],
            [
                "formal-caption",
                "formal-caption",
                "next-page-placeholder",
                "other",
                "panel-label",
                "caption-continuation",
                "caption-continuation",
                "other",
                "other",
                "next-page-placeholder",
                "other",
                "other",
                "other",
            ],
        )
        self.assertEqual(
            [item.get("figure_key") for item in items],
            [
                "figure:x",
                "figure:1",
                "figure:2",
                "figure:3",
                None,
                None,
                None,
                None,
                None,
                "figure:4",
                None,
                "figure:5",
                None,
            ],
        )
        caption = viewer["pages"][0]["blocks"][0]["caption"]
        self.assertEqual(
            caption["next_page_placeholders"],
            [
                {
                    "index": 2,
                    "text": "Fig. 2 | See next page for caption",
                    "figure_key": "figure:2",
                },
                {
                    "index": 9,
                    "text": "Figure 4. Caption continued on the next page.",
                    "figure_key": "figure:4",
                },
            ],
        )
        self.assertEqual(validate_viewer_index(viewer), [])

    def test_caption_detection_supports_decimal_and_undelimited_titles_but_rejects_references(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [50, 50, 950, 700],
                "img_path": "images/formats.jpg",
                "image_caption": [
                    "Supporting Information Figure 2.1 | A complete validation overview.",
                    "Figure 3.2 A complete caption without a punctuation delimiter.",
                    "Figure 3.2 illustrates the workflow in ordinary prose.",
                    "Figure 4 provides the comparison in ordinary prose.",
                    "Figure 5 map",
                ],
            }
        ]

        viewer = build_index(payload, "![](images/formats.jpg)\n")
        caption = viewer["pages"][0]["blocks"][0]["caption"]

        self.assertEqual(
            [item["kind"] for item in caption["items"]],
            ["formal-caption", "formal-caption", "other", "other", "other"],
        )
        self.assertEqual(
            [item.get("figure_key") for item in caption["items"][:2]],
            ["supporting-figure:2_1", "figure:3_2"],
        )
        self.assertEqual(caption["figure_anchor_count"], 2)
        self.assertEqual(validate_viewer_index(viewer), [])

    def test_broad_placeholder_candidates_never_create_cross_page_links(self) -> None:
        candidates = [
            "Fig. 3 | See next page for caption and trailing body prose.",
            "q r Extended Data Fig. 3 | See next page for caption and trailing body prose.",
        ]
        for candidate in candidates:
            with self.subTest(candidate=candidate):
                payload = [
                    {
                        "type": "image",
                        "page_idx": 0,
                        "bbox": [60, 80, 940, 780],
                        "img_path": "images/fig3.jpg",
                        "image_caption": [candidate],
                    },
                    {
                        "type": "text",
                        "page_idx": 1,
                        "bbox": [60, 60, 940, 290],
                        "text": "Fig. 3 | A formal caption on the following page.",
                    },
                ]
                viewer = build_index(payload, "![](images/fig3.jpg)\n")
                caption = viewer["pages"][0]["blocks"][0]["caption"]
                repair = build_visual_repair(viewer)

                self.assertEqual(caption["items"][0]["kind"], "other")
                self.assertEqual(caption["next_page_placeholders"], [])
                self.assertFalse(caption["next_page_marker"])
                self.assertEqual(caption["next_page_figure_keys"], [])
                self.assertEqual(repair["caption_links"], [])
                self.assertEqual(validate_viewer_index(viewer), [])
                self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_caption_item_validator_accepts_legacy_and_rejects_bad_atoms(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [50, 50, 950, 700],
                "img_path": "images/fig1.jpg",
                "image_caption": ["Figure 1. A formal caption."],
            }
        ]
        viewer = build_index(payload, "![](images/fig1.jpg)\n")
        caption = viewer["pages"][0]["blocks"][0]["caption"]
        items = caption.pop("items")

        self.assertEqual(validate_viewer_index(viewer), [])

        caption["items"] = items
        caption["items"][0]["kind"] = "other"
        errors = validate_viewer_index(viewer)
        self.assertTrue(
            any("misclassified viewer caption" in error for error in errors),
            errors,
        )

    def test_caption_continuation_alone_cannot_auto_merge_visuals(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [40 + index * 300, 80, 320 + index * 300, 350],
                "img_path": f"images/continuation-{index}.jpg",
                **(
                    {
                        "image_caption": [
                            "caption text continues without an explicit figure anchor."
                        ]
                    }
                    if index == 2
                    else {}
                ),
            }
            for index in range(3)
        ]
        markdown = "\n".join(
            f"![](images/continuation-{index}.jpg)" for index in range(3)
        )

        viewer = build_index(payload, markdown)
        repair = build_visual_repair(viewer)

        self.assertEqual(
            viewer["pages"][0]["blocks"][2]["caption"]["items"][0]["kind"],
            "caption-continuation",
        )
        self.assertEqual(repair["groups"][0]["decision"], "review")
        self.assertEqual(
            repair["groups"][0]["signals"]["figure_caption_anchor_count"], 0
        )
        self.assertIn(
            "insufficient_figure_anchor_evidence",
            repair["groups"][0]["warning_codes"],
        )

    def test_contract_builder_rejects_external_and_traversal_assets(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [10, 10, 200, 200],
                "img_path": "../outside.jpg",
            },
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [220, 10, 410, 200],
                "img_path": "https://example.test/remote.jpg",
            },
        ]
        viewer = build_index(
            payload,
            "![](../outside.jpg)\n![](https://example.test/remote.jpg)\n",
        )

        self.assertEqual(viewer["markdown_images"], [])
        self.assertTrue(
            all(block["asset_path"] is None for block in viewer["pages"][0]["blocks"])
        )
        self.assertEqual(validate_viewer_index(viewer), [])

        viewer["pages"][0]["blocks"][0]["asset_path"] = "images/../../escape.jpg"
        self.assertTrue(
            any("unsafe viewer block asset path" in error for error in validate_viewer_index(viewer))
        )

    def test_existing_enclosing_visual_is_reused(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [40, 40, 960, 800],
                "img_path": "images/full.jpg",
                "image_caption": ["Fig. 1. A sufficiently long complete figure caption."],
            },
            {
                "type": "chart",
                "page_idx": 0,
                "bbox": [80, 80, 450, 360],
                "img_path": "images/panel-a.jpg",
            },
            {
                "type": "chart",
                "page_idx": 0,
                "bbox": [500, 80, 900, 360],
                "img_path": "images/panel-b.jpg",
            },
        ]
        markdown = "\n".join(
            f"![]({path})"
            for path in ("images/full.jpg", "images/panel-a.jpg", "images/panel-b.jpg")
        )
        viewer = build_index(payload, markdown)
        relations = find_enclosing_visuals(viewer["pages"][0]["blocks"])
        repair = build_visual_repair(viewer)

        self.assertEqual(len(relations), 2)
        self.assertEqual(repair["summary"]["group_count"], 1)
        group = repair["groups"][0]
        self.assertEqual(group["replacement"]["mode"], "existing_asset")
        self.assertEqual(group["replacement"]["asset_path"], "images/full.jpg")
        self.assertEqual(group["decision"], "auto")
        self.assertEqual(group["fallback"], "original_assets")
        self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_adjacent_fragment_grid_creates_high_confidence_pdf_crop(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 4,
                "bbox": [50, 50, 480, 300],
                "img_path": "images/a.jpg",
                "image_caption": ["a"],
            },
            {
                "type": "chart",
                "page_idx": 4,
                "bbox": [485, 50, 950, 300],
                "img_path": "images/b.jpg",
                "chart_caption": ["b"],
            },
            {
                "type": "image",
                "page_idx": 4,
                "bbox": [50, 305, 480, 620],
                "img_path": "images/c.jpg",
            },
            {
                "type": "chart",
                "page_idx": 4,
                "bbox": [485, 305, 950, 620],
                "img_path": "images/d.jpg",
                "chart_caption": [
                    "Fig. 3. A long caption anchoring the complete multi-panel figure."
                ],
            },
        ]
        markdown = "\n".join(
            f"![]({path})"
            for path in (
                "images/a.jpg",
                "images/b.jpg",
                "images/c.jpg",
                "images/d.jpg",
            )
        )
        viewer = build_index(payload, markdown)
        repair = build_visual_repair(viewer)

        self.assertEqual(repair["summary"]["group_count"], 1)
        group = repair["groups"][0]
        self.assertEqual(group["replacement"]["mode"], "pdf_crop")
        self.assertEqual(group["replacement"]["bbox_norm"], [50, 50, 950, 620])
        self.assertEqual(group["decision"], "auto")
        self.assertGreaterEqual(group["confidence"], 0.85)
        self.assertEqual(group["signals"]["panel_label_count"], 2)
        self.assertEqual(len(group["caption_anchor_block_ids"]), 1)

    def test_stacked_figure_rows_with_panel_descriptions_form_one_pdf_crop(self) -> None:
        """A Figure 1 regression: MinerU may put prose between stacked panel rows."""

        payload = [
            {
                "type": "image",
                "page_idx": 1,
                "bbox": [60, 60, 894, 294],
                "img_path": "images/a.jpg",
                "image_caption": [
                    "d",
                    "Application 1: Anticipation and targeted discovery of undiscovered metabolites",
                ],
            },
            {
                "type": "image",
                "page_idx": 1,
                "bbox": [65, 327, 942, 484],
                "img_path": "images/application.jpg",
                "image_caption": [
                    "Application 2: Structure annotation of unknown metabolites via mass spectrometry"
                ],
            },
            {
                "type": "image",
                "page_idx": 1,
                "bbox": [58, 489, 576, 634],
                "img_path": "images/b.jpg",
            },
            {
                "type": "chart",
                "page_idx": 1,
                "bbox": [581, 491, 793, 651],
                "img_path": "images/c.jpg",
            },
            {
                "type": "chart",
                "page_idx": 1,
                "bbox": [796, 494, 944, 651],
                "img_path": "images/d.jpg",
                "chart_caption": [
                    "Fig. 1 | Learning the language of metabolism. a, Schematic overview of DeepMet.",
                    "b–d, Quantitative evaluation of generated metabolites and transformations.",
                ],
            },
        ]
        markdown = "\n".join(
            (
                "![](images/a.jpg)",
                "Application 2: Structure annotation of unknown metabolites",
                "![](images/application.jpg)",
                "![](images/b.jpg)",
                "![](images/c.jpg)",
                "![](images/d.jpg)",
            )
        )

        repair = build_visual_repair(build_index(payload, markdown))

        self.assertEqual(repair["algorithm_version"], "visual-repair-v1.6")
        self.assertEqual(repair["summary"]["group_count"], 1)
        group = repair["groups"][0]
        self.assertEqual(group["member_block_ids"], [
            "p0001-s000000",
            "p0001-s000001",
            "p0001-s000002",
            "p0001-s000003",
            "p0001-s000004",
        ])
        self.assertEqual(group["replacement"]["mode"], "pdf_crop")
        self.assertEqual(group["replacement"]["bbox_norm"], [58, 60, 944, 651])
        self.assertEqual(group["decision"], "auto")
        self.assertGreaterEqual(group["confidence"], 0.85)
        self.assertEqual(group["signals"]["figure_caption_anchor_count"], 1)
        self.assertNotIn("multiple_long_caption_anchors", group["warning_codes"])

    def test_close_components_without_explicit_figure_anchor_are_not_bridged(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [50, 100, 300, 250],
                "img_path": "images/a1.jpg",
                "image_caption": ["a"],
            },
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [50, 255, 300, 405],
                "img_path": "images/a2.jpg",
                "image_caption": ["b"],
            },
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [324, 100, 500, 170],
                "img_path": "images/b1.jpg",
                "image_caption": ["c"],
            },
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [324, 175, 500, 245],
                "img_path": "images/b2.jpg",
                "image_caption": ["d"],
            },
        ]
        markdown = "\n".join(
            f"![](images/{name}.jpg)" for name in ("a1", "a2", "b1", "b2")
        )

        repair = build_visual_repair(build_index(payload, markdown))

        self.assertEqual(repair["summary"]["group_count"], 2)
        self.assertEqual(
            sorted(len(group["member_block_ids"]) for group in repair["groups"]),
            [2, 2],
        )
        self.assertTrue(all(group["decision"] != "auto" for group in repair["groups"]))

    def test_nested_panel_group_is_folded_into_complete_figure(self) -> None:
        placeholder = "Extended Data Fig. 4 | See next page for caption."
        payload = [
            {
                "type": "image",
                "page_idx": 25,
                "bbox": [50, 50, 350, 300],
                "img_path": "images/whole-a.jpg",
                "image_caption": ["a"],
            },
            {
                "type": "image",
                "page_idx": 25,
                "bbox": [350, 50, 650, 300],
                "img_path": "images/whole-b.jpg",
                "image_caption": ["b"],
            },
            {
                "type": "image",
                "page_idx": 25,
                "bbox": [650, 50, 950, 300],
                "img_path": "images/whole-c.jpg",
                "image_caption": ["c"],
            },
            {
                "type": "image",
                "page_idx": 25,
                "bbox": [50, 300, 650, 900],
                "img_path": "images/whole-o.jpg",
                "image_caption": ["o"],
            },
            {
                "type": "image",
                "page_idx": 25,
                "bbox": [700, 550, 920, 700],
                "img_path": "images/repeated-pq.jpg",
                "image_caption": [placeholder, "p", "q"],
            },
            {
                "type": "image",
                "page_idx": 25,
                "bbox": [700, 705, 920, 860],
                "img_path": "images/repeated-rs.jpg",
                "image_caption": ["r", "s"],
            },
            {
                "type": "text",
                "page_idx": 26,
                "bbox": [50, 50, 950, 170],
                "text": "Extended Data Fig. 4 | A complete caption on the next page.",
            },
        ]
        markdown = "\n".join(
            [
                "![](images/whole-a.jpg)",
                "![](images/whole-b.jpg)",
                "![](images/whole-c.jpg)",
                "![](images/whole-o.jpg)",
                "![](images/repeated-pq.jpg)",
                "![](images/repeated-rs.jpg)",
            ]
        )
        viewer = build_index(payload, markdown)
        repair = build_visual_repair(viewer)

        self.assertEqual(repair["summary"]["group_count"], 1)
        group = repair["groups"][0]
        self.assertEqual(
            group["member_block_ids"],
            [
                "p0025-s000000",
                "p0025-s000001",
                "p0025-s000002",
                "p0025-s000003",
                "p0025-s000004",
                "p0025-s000005",
            ],
        )
        self.assertEqual(group["replacement"]["bbox_norm"], [50, 50, 950, 900])
        self.assertIn("nested_visual_overlap_deduplicated", group["reason_codes"])
        self.assertEqual(group["signals"]["nested_group_count"], 1)
        self.assertEqual(group["caption_anchor_block_ids"], ["p0025-s000004"])
        self.assertEqual(group["signals"]["figure_caption_anchor_count"], 1)
        self.assertEqual(repair["summary"]["caption_link_count"], 1)
        self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_nested_group_without_figure_identity_or_full_containment_is_kept(self) -> None:
        viewer = build_index(
            [
                {
                    "type": "image",
                    "page_idx": 0,
                    "bbox": [50, 50, 950, 900],
                    "img_path": "images/whole.jpg",
                },
                {
                    "type": "image",
                    "page_idx": 0,
                    "bbox": [700, 550, 920, 860],
                    "img_path": "images/child.jpg",
                },
            ],
            "![](images/whole.jpg)\n![](images/child.jpg)\n",
        )
        blocks = viewer["pages"][0]["blocks"]
        groups = [
            {
                "id": "outer",
                "page_idx": 0,
                "member_block_ids": [blocks[0]["id"]],
                "member_asset_paths": [blocks[0]["asset_path"]],
                "member_markdown_image_ids": ["md-img-0000"],
                "caption_anchor_block_ids": [],
                "decision": "auto",
                "confidence": 0.95,
                "replacement": {
                    "mode": "pdf_crop",
                    "bbox_norm": [50, 50, 950, 900],
                    "padding_norm": 6,
                },
                "signals": {},
                "reason_codes": [],
                "warning_codes": [],
                "fallback": "original_assets",
            },
            {
                "id": "inner",
                "page_idx": 0,
                "member_block_ids": [blocks[1]["id"]],
                "member_asset_paths": [blocks[1]["asset_path"]],
                "member_markdown_image_ids": ["md-img-0001"],
                "caption_anchor_block_ids": [],
                "decision": "auto",
                "confidence": 0.95,
                "replacement": {
                    "mode": "pdf_crop",
                    "bbox_norm": [700, 550, 920, 860],
                    "padding_norm": 6,
                },
                "signals": {},
                "reason_codes": [],
                "warning_codes": [],
                "fallback": "original_assets",
            },
        ]
        self.assertEqual(len(merge_nested_visual_repair_groups(groups, viewer)), 2)

        blocks[1]["caption"] = {
            **blocks[1]["caption"],
            "formal_figure_caption_keys": ["figure:4"],
            "next_page_figure_keys": ["figure:4"],
        }
        partial_overlap = [dict(group) for group in groups]
        partial_overlap[1] = {
            **partial_overlap[1],
            "replacement": {
                **partial_overlap[1]["replacement"],
                "bbox_norm": [850, 550, 990, 860],
            },
        }
        self.assertEqual(
            len(merge_nested_visual_repair_groups(partial_overlap, viewer)), 2
        )

    def test_nearby_fragments_with_same_next_standalone_caption_are_merged(self) -> None:
        caption = "Figure 7 A complete standalone caption shared by both nearby fragments."
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 100, 460, 390],
                "img_path": "images/left.jpg",
            },
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [510, 100, 930, 390],
                "img_path": "images/right.jpg",
            },
            {
                "type": "text",
                "page_idx": 0,
                "bbox": [60, 420, 930, 510],
                "text": caption,
            },
        ]
        markdown = "\n".join(
            ["![](images/left.jpg)", "![](images/right.jpg)", caption]
        )

        viewer = build_index(payload, markdown)
        repair = build_visual_repair(viewer)

        self.assertEqual(repair["summary"]["group_count"], 1)
        group = repair["groups"][0]
        self.assertEqual(
            group["member_block_ids"], ["p0000-s000000", "p0000-s000001"]
        )
        self.assertEqual(group["replacement"]["bbox_norm"], [60, 100, 930, 390])
        self.assertEqual(group["decision"], "auto")
        self.assertEqual(group["signals"]["figure_caption_anchor_count"], 1)
        self.assertEqual(group["caption_anchor_block_ids"], ["p0000-s000002"])
        self.assertIn(
            "standalone_figure_caption_after_visuals", group["reason_codes"]
        )
        self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_different_caption_intervals_and_reference_verbs_do_not_merge(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 100, 460, 390],
                "img_path": "images/first.jpg",
            },
            {
                "type": "text",
                "page_idx": 0,
                "bbox": [60, 400, 460, 470],
                "text": "Figure 1 A complete caption for the first independent figure.",
            },
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [510, 100, 930, 390],
                "img_path": "images/second.jpg",
            },
            {
                "type": "text",
                "page_idx": 0,
                "bbox": [510, 400, 930, 470],
                "text": "Figure 2 shows the second result in ordinary body prose.",
            },
        ]
        markdown = "\n".join(
            ["![](images/first.jpg)", "![](images/second.jpg)"]
        )

        viewer = build_index(payload, markdown)
        repair = build_visual_repair(viewer)

        self.assertEqual(
            viewer["pages"][0]["blocks"][3]["text"][
                "leading_formal_figure_caption_key"
            ],
            None,
        )
        self.assertEqual(repair["summary"]["group_count"], 0)

    def test_multiple_figure_captions_force_review_fallback(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 2,
                "bbox": [40, 50, 330, 300],
                "img_path": "images/a.jpg",
                "image_caption": ["Fig. 1. A long caption for one independent figure."],
            },
            {
                "type": "image",
                "page_idx": 2,
                "bbox": [335, 50, 625, 300],
                "img_path": "images/b.jpg",
            },
            {
                "type": "image",
                "page_idx": 2,
                "bbox": [630, 50, 920, 300],
                "img_path": "images/c.jpg",
                "image_caption": ["Fig. 2. A different long caption creating ambiguity."],
            },
        ]
        markdown = "\n".join(
            f"![]({path})" for path in ("images/a.jpg", "images/b.jpg", "images/c.jpg")
        )
        viewer = build_index(payload, markdown)
        repair = build_visual_repair(viewer)

        group = repair["groups"][0]
        self.assertEqual(group["decision"], "review")
        self.assertIn("multiple_figure_caption_anchors", group["warning_codes"])
        self.assertEqual(group["fallback"], "original_assets")

    def test_adjacent_images_without_figure_evidence_never_auto_merge(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [40 + index * 300, 80, 320 + index * 300, 350],
                "img_path": f"images/independent-{index}.jpg",
            }
            for index in range(3)
        ]
        markdown = "\n".join(
            f"![](images/independent-{index}.jpg)" for index in range(3)
        )

        repair = build_visual_repair(build_index(payload, markdown))

        group = repair["groups"][0]
        self.assertEqual(group["decision"], "review")
        self.assertLess(group["confidence"], 0.85)
        self.assertIn(
            "insufficient_figure_anchor_evidence", group["warning_codes"]
        )

    def test_single_markdown_reference_is_not_contiguous_group_evidence(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [50, 50, 950, 800],
                "img_path": "images/full.jpg",
            },
            {
                "type": "chart",
                "page_idx": 0,
                "bbox": [90, 90, 420, 350],
                "img_path": "images/panel.jpg",
            },
        ]

        repair = build_visual_repair(
            build_index(payload, "![](images/full.jpg)\n")
        )

        group = repair["groups"][0]
        self.assertFalse(group["signals"]["markdown_references_contiguous"])
        self.assertEqual(group["signals"]["markdown_reference_coverage"], 0.5)
        self.assertEqual(group["decision"], "review")

    def test_near_full_page_enclosing_single_child_requires_review(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [10, 10, 990, 960],
                "img_path": "images/page.jpg",
                "image_caption": [
                    "Fig. 1. A sufficiently long caption that otherwise looks reliable."
                ],
            },
            {
                "type": "chart",
                "page_idx": 0,
                "bbox": [100, 100, 500, 420],
                "img_path": "images/child.jpg",
            },
        ]
        markdown = "![](images/page.jpg)\n![](images/child.jpg)\n"

        repair = build_visual_repair(build_index(payload, markdown))

        group = repair["groups"][0]
        self.assertEqual(group["decision"], "review")
        self.assertIn("near_full_page_enclosing_asset", group["warning_codes"])

    def test_single_column_caption_on_immediate_next_page_is_linked(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 80, 940, 780],
                "img_path": "images/fig2.jpg",
                "image_caption": ["Fig. 2 | See next page for caption"],
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 60, 940, 290],
                "text": "Fig. 2. A formal single-column figure caption.",
            },
        ]
        viewer = build_index(payload, "![](images/fig2.jpg)\n")
        repair = build_visual_repair(viewer)

        visual = viewer["pages"][0]["blocks"][0]
        caption = viewer["pages"][1]["blocks"][0]
        self.assertEqual(visual["caption"]["figure_keys"], ["figure:2"])
        self.assertTrue(visual["caption"]["next_page_marker"])
        self.assertEqual(caption["text"]["leading_figure_key"], "figure:2")
        self.assertEqual(
            caption["text"]["leading_formal_figure_caption_key"], "figure:2"
        )
        self.assertEqual(
            repair["caption_links"],
            [
                {
                    "visual_block_id": "p0000-s000000",
                    "caption_block_ids": ["p0001-s000001"],
                    "source_page_idx": 0,
                    "target_page_idx": 1,
                    "figure_key": "figure:2",
                    "relation": "next_page_figure_caption",
                    "status": "complete",
                }
            ],
        )
        self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_caption_link_validator_rejects_nonadjacent_target(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 80, 940, 780],
                "img_path": "images/fig2.jpg",
                "image_caption": ["Fig. 2 | See next page for caption"],
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 60, 940, 290],
                "text": "Fig. 2 | A formal single-column figure caption.",
            },
        ]
        viewer = build_index(payload, "![](images/fig2.jpg)\n")
        repair = build_visual_repair(viewer)
        repair["caption_links"][0]["target_page_idx"] = 2

        errors = validate_visual_repair(repair, viewer)

        self.assertTrue(
            any("target is not the next page" in error for error in errors), errors
        )
        self.assertTrue(
            any("caption block is on another page" in error for error in errors), errors
        )

    def test_polluted_placeholder_span_links_without_removing_prefix(self) -> None:
        payload = [
            {
                "type": "chart",
                "page_idx": 5,
                "bbox": [60, 80, 940, 800],
                "img_path": "images/extended-3.jpg",
                "chart_caption": [
                    "q r Extended Data Fig. 3 | See next page for caption."
                ],
            },
            {
                "type": "text",
                "page_idx": 6,
                "bbox": [60, 60, 497, 390],
                "text": "Extended Data Fig. 3 | A long caption beginning in the left column",
            },
            {
                "type": "text",
                "page_idx": 6,
                "bbox": [507, 59, 944, 389],
                "text": "plot description continues safely in the right column.",
            },
        ]
        viewer = build_index(payload, "![](images/extended-3.jpg)\n")
        repair = build_visual_repair(viewer)

        visual_caption = viewer["pages"][0]["blocks"][0]["caption"]
        self.assertEqual(visual_caption["items"][0]["kind"], "other")
        self.assertEqual(
            visual_caption["next_page_placeholders"],
            [
                {
                    "index": 0,
                    "text": "Extended Data Fig. 3 | See next page for caption.",
                    "figure_key": "extended-data-figure:3",
                }
            ],
        )
        self.assertNotIn("q r", visual_caption["next_page_placeholders"][0]["text"])
        self.assertEqual(
            visual_caption["next_page_figure_keys"],
            ["extended-data-figure:3"],
        )
        self.assertEqual(validate_viewer_index(viewer), [])
        link = repair["caption_links"][0]
        self.assertEqual(link["figure_key"], "extended-data-figure:3")
        self.assertEqual(
            link["caption_block_ids"],
            ["p0006-s000001", "p0006-s000002"],
        )
        self.assertEqual(link["status"], "complete")
        self.assertEqual(repair["summary"]["complete_caption_link_count"], 1)
        self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_empty_adjacent_caption_column_marks_link_partial(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 3,
                "bbox": [60, 60, 947, 772],
                "img_path": "images/fig2.jpg",
                "image_caption": ["Fig. 2 | See next page for caption"],
            },
            {
                "type": "text",
                "page_idx": 4,
                "bbox": [60, 59, 497, 250],
                "text": "Fig. 2 | Caption text extracted only in the left column showing",
            },
            {
                "type": "text",
                "page_idx": 4,
                "bbox": [507, 59, 944, 237],
                "text": "",
            },
        ]
        viewer = build_index(payload, "![](images/fig2.jpg)\n")
        repair = build_visual_repair(viewer)

        link = repair["caption_links"][0]
        self.assertEqual(link["caption_block_ids"], ["p0004-s000001"])
        self.assertEqual(link["status"], "partial")
        partial_issue = next(
            issue
            for issue in repair["issues"]
            if issue["code"] == "partial_next_page_figure_caption"
        )
        self.assertEqual(
            partial_issue["reason_codes"], ["empty_adjacent_caption_column"]
        )
        self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_terminal_caption_before_empty_column_is_complete(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 7,
                "bbox": [60, 60, 947, 772],
                "img_path": "images/extended-5.jpg",
                "image_caption": [
                    "Extended Data Fig. 5 | See next page for caption"
                ],
            },
            {
                "type": "text",
                "page_idx": 8,
                "bbox": [60, 59, 497, 250],
                "text": "Extended Data Fig. 5 | A complete single-column caption.",
            },
            {
                "type": "text",
                "page_idx": 8,
                "bbox": [507, 59, 944, 237],
                "text": "",
            },
        ]

        viewer = build_index(payload, "![](images/extended-5.jpg)\n")
        repair = build_visual_repair(viewer)

        link = repair["caption_links"][0]
        self.assertEqual(link["caption_block_ids"], ["p0008-s000001"])
        self.assertEqual(link["status"], "complete")
        self.assertEqual(repair["summary"]["complete_caption_link_count"], 1)
        self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_terminal_caption_does_not_absorb_lowercase_body_text(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 60, 947, 772],
                "img_path": "images/fig2.jpg",
                "image_caption": ["Fig. 2 | See next page for caption"],
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 59, 497, 250],
                "text": "Fig. 2 | A complete caption ending in this column.",
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [507, 59, 944, 237],
                "text": "ordinary lowercase body prose must not be attached.",
            },
        ]

        viewer = build_index(payload, "![](images/fig2.jpg)\n")
        repair = build_visual_repair(viewer)

        link = repair["caption_links"][0]
        self.assertEqual(link["caption_block_ids"], ["p0001-s000001"])
        self.assertEqual(link["status"], "complete")
        self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_unterminated_caption_without_adjacent_column_is_partial(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 60, 947, 772],
                "img_path": "images/fig2.jpg",
                "image_caption": ["Fig. 2 | See next page for caption"],
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 59, 944, 250],
                "text": "Fig. 2 | An extracted caption that ends without punctuation",
            },
        ]

        viewer = build_index(payload, "![](images/fig2.jpg)\n")
        repair = build_visual_repair(viewer)

        link = repair["caption_links"][0]
        self.assertEqual(link["status"], "partial")
        issue = next(
            issue
            for issue in repair["issues"]
            if issue["code"] == "partial_next_page_figure_caption"
        )
        self.assertEqual(issue["reason_codes"], ["unterminated_caption_anchor"])
        self.assertEqual(validate_visual_repair(repair, viewer), [])

    def test_prose_figure_reference_is_not_a_formal_caption_anchor(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 60, 947, 772],
                "img_path": "images/fig2.jpg",
                "image_caption": ["Fig. 2 | See next page for caption"],
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 59, 944, 180],
                "text": "Fig. 2 shows the result discussed in the main text.",
            },
        ]

        viewer = build_index(payload, "![](images/fig2.jpg)\n")
        text_summary = viewer["pages"][1]["blocks"][0]["text"]
        repair = build_visual_repair(viewer)

        self.assertEqual(text_summary["leading_figure_key"], "figure:2")
        self.assertIsNone(text_summary["leading_formal_figure_caption_key"])
        self.assertEqual(repair["caption_links"], [])
        issue = next(
            issue
            for issue in repair["issues"]
            if issue["code"] == "next_page_figure_caption_not_found"
        )
        self.assertEqual(issue["scan_boundary"], "nonformal_figure_reference")

    def test_reading_boundaries_block_later_repeated_caption_key(self) -> None:
        boundaries = [
            {
                "type": "image",
                "page_idx": 1,
                "bbox": [60, 50, 300, 180],
                "img_path": "images/unrelated.jpg",
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 50, 940, 100],
                "text": "Results",
                "text_level": 2,
            },
        ]
        for boundary in boundaries:
            with self.subTest(boundary=boundary["type"], title=boundary.get("text")):
                payload = [
                    {
                        "type": "image",
                        "page_idx": 0,
                        "bbox": [60, 60, 947, 772],
                        "img_path": "images/fig2.jpg",
                        "image_caption": ["Fig. 2 | See next page for caption"],
                    },
                    boundary,
                    {
                        "type": "text",
                        "page_idx": 1,
                        "bbox": [60, 110, 940, 260],
                        "text": "Fig. 2 | A repeated key after the reading boundary.",
                    },
                ]
                repair = build_visual_repair(
                    build_index(payload, "![](images/fig2.jpg)\n")
                )

                self.assertEqual(repair["caption_links"], [])
                issue = next(
                    issue
                    for issue in repair["issues"]
                    if issue["code"] == "next_page_figure_caption_not_found"
                )
                expected = (
                    "visual_boundary" if boundary["type"] == "image" else "title_boundary"
                )
                self.assertEqual(issue["scan_boundary"], expected)

    def test_ordinary_figure_caption_without_next_page_marker_is_not_linked(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 80, 940, 780],
                "img_path": "images/fig6.jpg",
                "image_caption": ["Fig. 6 | A complete caption on this page."],
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 60, 940, 260],
                "text": "Fig. 6 | Unrelated repeated figure text.",
            },
        ]
        repair = build_visual_repair(build_index(payload, "![](images/fig6.jpg)\n"))

        self.assertEqual(repair["caption_links"], [])
        self.assertFalse(
            any("next_page_figure_caption" in issue["code"] for issue in repair["issues"])
        )

    def test_different_figure_key_on_next_page_is_not_linked(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 80, 940, 780],
                "img_path": "images/fig2.jpg",
                "image_caption": ["Fig. 2 | See next page for caption"],
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 60, 940, 260],
                "text": "Fig. 3 | A caption for another figure.",
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 270, 940, 310],
                "text": "Fig. 2 | A matching caption after the wrong figure boundary.",
            },
        ]
        repair = build_visual_repair(build_index(payload, "![](images/fig2.jpg)\n"))

        self.assertEqual(repair["caption_links"], [])
        issue = next(
            issue
            for issue in repair["issues"]
            if issue["code"] == "next_page_figure_caption_not_found"
        )
        self.assertEqual(issue["figure_key"], "figure:2")
        self.assertEqual(issue["alternate_figure_keys"], ["figure:3"])
        self.assertEqual(issue["scan_boundary"], "different_figure_key")

    def test_multiple_same_key_caption_candidates_are_ambiguous(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 80, 940, 780],
                "img_path": "images/fig2.jpg",
                "image_caption": ["Figure 2 | Continued on next page"],
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [60, 60, 480, 180],
                "text": "Fig. 2 | First candidate caption.",
            },
            {
                "type": "text",
                "page_idx": 1,
                "bbox": [520, 60, 940, 180],
                "text": "Figure 2 | Second candidate caption.",
            },
        ]
        repair = build_visual_repair(build_index(payload, "![](images/fig2.jpg)\n"))

        self.assertEqual(repair["caption_links"], [])
        issue = next(
            issue
            for issue in repair["issues"]
            if issue["code"] == "ambiguous_next_page_figure_caption"
        )
        self.assertEqual(issue["candidate_count"], 2)

    def test_caption_on_nonadjacent_page_is_not_linked(self) -> None:
        payload = [
            {
                "type": "image",
                "page_idx": 0,
                "bbox": [60, 80, 940, 780],
                "img_path": "images/fig2.jpg",
                "image_caption": ["图 2 | 图注见下一页"],
            },
            {
                "type": "text",
                "page_idx": 2,
                "bbox": [60, 60, 940, 260],
                "text": "图 2 | 正式图注实际在隔了一页后才出现。",
            },
        ]
        repair = build_visual_repair(build_index(payload, "![](images/fig2.jpg)\n"))

        self.assertEqual(repair["caption_links"], [])
        issue = next(
            issue
            for issue in repair["issues"]
            if issue["code"] == "next_page_figure_caption_not_found"
        )
        self.assertEqual(issue["target_page_idx"], 1)


if __name__ == "__main__":
    unittest.main()
