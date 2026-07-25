from __future__ import annotations

import argparse
import re
from pathlib import Path

import yaml


PROJECT_ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = PROJECT_ROOT / "knowledge-base" / "wiki" / "sources"

TRANSLATIONS = {
    "Genomic analyses identify molecular subtypes of pancreatic cancer": "基因组分析鉴定胰腺癌分子亚型",
    "Regulation of chromatin by histone modifications": "组蛋白修饰对染色质的调控",
    "Novae: a graph-based foundation model for spatial transcriptomics data": "Novae：用于空间转录组数据的图基础模型",
    "Multiscale 3D Genome Rewiring during Mouse Neural Development": "小鼠神经发育过程中的多尺度三维基因组重连",
    "Post-Translational Modifications of Histones That Influence Nucleosome Dynamics": "影响核小体动态的组蛋白翻译后修饰",
    "Genomic mapping of RNA polymerase II reveals sites of co-transcriptional regulation in human cells": "RNA 聚合酶 II 基因组图谱揭示人类细胞中的共转录调控位点",
    "Decoupling Epigenetic and Genetic Effects through Systematic Analysis of Gene Position": "通过系统分析基因位置解耦表观遗传与遗传效应",
    "Pan-cancer spatial atlas of tertiary lymphoid structures": "泛癌种三级淋巴结构空间图谱",
    "Defining the Status of RNA Polymerase at Promoters": "界定启动子处 RNA 聚合酶的状态",
    "Single‐Cell Hi‐C Technologies and Computational Data Analysis": "单细胞 Hi-C 技术与计算数据分析",
    "The 3D Genome as Moderator of Chromosomal Communication": "作为染色体通讯调节者的三维基因组",
    "Neuronal DNA double-strand breaks lead to genome structural variations and 3D genome disruption in neurodegeneration": "神经元 DNA 双链断裂导致神经退行性变中的基因组结构变异和三维基因组破坏",
    "Chromatin architecture reorganization during stem cell differentiation": "干细胞分化过程中的染色质结构重组",
    "Topological domains in mammalian genomes identified by analysis of chromatin interactions": "通过染色质相互作用分析鉴定哺乳动物基因组中的拓扑结构域",
    "Dynamic Interplay between Structural Variations and 3D Genome Organization in Pancreatic Cancer": "胰腺癌中结构变异与三维基因组组织的动态互作",
    "Revisiting 3D chromatin architecture in cancer development and progression": "重新审视癌症发生与进展中的三维染色质结构",
    "Extensive Heterogeneity and Intrinsic Variation in Spatial Genome Organization": "空间基因组组织的广泛异质性与内在变异",
    "Molecular basis and biological function of variability in spatial genome organization": "空间基因组组织变异的分子基础与生物学功能",
    "Epigenetic plasticity and the hallmarks of cancer": "表观遗传可塑性与癌症标志",
    "Whole-genome doubling perturbs the 3D genome": "全基因组加倍扰动三维基因组",
    "The spatial organization of transcriptional control": "转录调控的空间组织",
    "Advances in the multimodal analysis of the 3D chromatin structure and gene regulation": "三维染色质结构与基因调控多模态分析进展",
    "Transcription Elongation Can Affect Genome 3D Structure": "转录延伸可影响基因组三维结构",
    "A Phase Separation Model for Transcriptional Control": "转录调控的相分离模型",
    "Physical and data structure of 3D genome": "三维基因组的物理结构与数据结构",
    "EVR: reconstruction of bacterial chromosome 3D structure models using error-vector resultant algorithm": "EVR：基于误差向量合成算法重建细菌染色体三维结构模型",
    "TAD fusion score: discovery and ranking the contribution of deletions to genome structure": "TAD 融合评分：发现并排序缺失对基因组结构的贡献",
    "Multi-omics integration and machine learning reveal gut-immune signatures in idiopathic pulmonary fibrosis: insights from bulk RNA-seq, single-cell profiles, spatial transcriptomics, and experimental validation": "多组学整合与机器学习揭示特发性肺纤维化的肠道-免疫特征：来自 bulk RNA-seq、单细胞图谱、空间转录组和实验验证的洞见",
    "Understanding 3D genome organization by multidisciplinary methods": "通过多学科方法理解三维基因组组织",
    "Revealing the transcriptional heterogeneity of organ-specific metastasis in human gastric cancer using single-cell RNA Sequencing": "利用单细胞 RNA 测序揭示人胃癌器官特异性转移的转录异质性",
    "Genomic landscape of the human vaginal microbiome is linked to host genetics and population of origin": "人类阴道微生物组的基因组图谱与宿主遗传和来源人群相关",
    "Getting up to speed with transcription elongation by RNA polymerase II": "跟上 RNA 聚合酶 II 转录延伸的步伐",
    "Chromatin loop anchors are associated with genome instability in cancer and recombination hotspots in the germline": "染色质环锚点与癌症基因组不稳定性及生殖系重组热点相关",
    "Identifying quantitatively differential chromosomal compartmentalization changes and their biological significance from Hi-C data using DARIC": "使用 DARIC 从 Hi-C 数据中识别定量差异的染色体区室化变化及其生物学意义",
    "Considerations and caveats for analyzing chromatin compartments": "染色质区室分析的注意事项与局限",
    "Polymer coil–globule phase transition is a universal folding principle of Drosophila epigenetic domains": "聚合物线团-球状体相变是果蝇表观遗传结构域的普适折叠原理",
    "Comprehensive Mapping of Long-Range Interactions Reveals Folding Principles of the Human Genome": "长程相互作用综合图谱揭示人类基因组折叠原理",
    "Tracing the evolution of single-cell 3D genomes in Kras-driven cancers": "追踪 Kras 驱动癌症中单细胞三维基因组的演化",
    "Cellular architecture and neighborhood-informed virtual spatial tumor profiling from histopathology": "基于细胞结构和邻域信息从组织病理图像进行虚拟空间肿瘤分析",
    "HiCDOC: chromatin compartment prediction and differential analysis from Hi-C data with replicates": "HiCDOC：基于重复 Hi-C 数据的染色质区室预测与差异分析",
    "Structural basis of H3K36 trimethylation by SETD2 during chromatin transcription": "染色质转录过程中 SETD2 介导 H3K36 三甲基化的结构基础",
    "Surface optimization governs the local design of physical networks": "表面优化支配物理网络的局部设计",
    "Quantifying conformational heterogeneity of 3D genome organization in fruit fly": "量化果蝇三维基因组组织的构象异质性",
    "The fractal globule as a model of chromatin architecture in the cell": "分形球状体作为细胞内染色质结构模型",
    "Two major mechanisms of chromosome organization": "染色体组织的两大主要机制",
    "The Self-Organizing Genome: Principles of Genome Architecture and Function": "自组织基因组：基因组结构与功能的原理",
    "Protein and genomic language models uncover the unexplored diversity of bacterial immunity": "蛋白质与基因组语言模型揭示细菌免疫中尚未探索的多样性",
    "Language model-guided anticipation and discovery of mammalian metabolites": "语言模型引导的哺乳动物代谢物预判与发现",
    "A 3D Map of the Human Genome at Kilobase Resolution Reveals Principles of Chromatin Looping": "千碱基分辨率人类基因组三维图谱揭示染色质环形成原理",
    "High-resolution Hi-C maps highlight multiscale 3D epigenome reprogramming during pancreatic cancer metastasis": "高分辨率 Hi-C 图谱揭示胰腺癌转移过程中的多尺度三维表观基因组重编程",
    "High-Resolution Mapping of Chromatin Conformation in Cardiac Myocytes Reveals Structural Remodeling of the Epigenome in Heart Failure": "心肌细胞染色质构象高分辨率图谱揭示心力衰竭中的表观基因组结构重塑",
    "Organizational principles of 3D genome architecture": "三维基因组结构的组织原则",
    "Long-range enhancer–promoter contacts in gene expression control": "基因表达调控中的远程增强子-启动子接触",
    "HiC-Pro: an optimized and flexible pipeline for Hi-C data processing": "HiC-Pro：优化且灵活的 Hi-C 数据处理流程",
    "Systematic perturbations of SETD2, NSD1, NSD2, NSD3, and ASH1L reveal their distinct contributions to H3K36 methylation": "系统扰动 SETD2、NSD1、NSD2、NSD3 和 ASH1L 揭示其对 H3K36 甲基化的不同贡献",
    "Structural variants in the 3D genome as drivers of disease": "作为疾病驱动因素的三维基因组结构变异",
    "Chromatin modules and their implication in genomic organization and gene regulation": "染色质模块及其对基因组组织和基因调控的影响",
    "Histone exchange, chromatin structure and the regulation of transcription": "组蛋白交换、染色质结构与转录调控",
    "Molecular mechanism of co-transcriptional H3K36 methylation by SETD2": "SETD2 共转录 H3K36 甲基化的分子机制",
    "A genome-wide association study integrated with single-cell and bulk profiles uncovers susceptibility genes for nasopharyngeal carcinoma involved in tumorigenesis via regulation of T cells": "全基因组关联研究整合单细胞与 bulk 图谱揭示通过调控 T 细胞参与鼻咽癌发生的易感基因",
    "3D genome organization shapes DNA damage susceptibility to platinum-based drugs": "三维基因组组织塑造 DNA 对铂类药物损伤的易感性",
    "EVRC: reconstruction of chromosome 3D structure models using error-vector resultant algorithm with clustering coefficient": "EVRC：使用结合聚类系数的误差向量合成算法重建染色体三维结构模型",
    "Spatial Chromosome Organization and Adaptation of Escherichia coli under Heat Stress": "热应激下大肠杆菌的染色体空间组织与适应",
    "SPIN reveals genome-wide landscape of nuclear compartmentalization": "SPIN 揭示全基因组核区室化图谱",
    "H3K36 trimethylation-mediated biological functions in cancer": "H3K36 三甲基化介导的癌症生物学功能",
    "How subtle changes in 3D structure can create large changes in transcription": "三维结构的细微变化如何引发转录的巨大变化",
    "Three-dimensional genome landscape of primary human cancers": "人类原发癌症的三维基因组图谱",
    "Three-dimensional genome landscape comprehensively reveals patterns of spatial gene regulation in papillary and anaplastic thyroid cancers: a study using representative cell lines for each cancer type": "三维基因组图谱全面揭示甲状腺乳头状癌和未分化癌的空间基因调控模式：基于各癌种代表性细胞系的研究",
    "ZNF143 deletion alters enhancer/promoter looping and CTCF/cohesin geometry": "ZNF143 缺失改变增强子/启动子环化及 CTCF/cohesin 几何结构",
    "CscoreTool: fast Hi-C compartment analysis at high resolution": "CscoreTool：快速高分辨率 Hi-C 区室分析",
    "MaxComp: Predicting single-cell chromatin compartments from 3D chromosome structures": "MaxComp：从三维染色体结构预测单细胞染色质区室",
}


def scalar_from_line(line: str, key: str) -> str:
    match = re.match(rf"^{re.escape(key)}:\s*(.*?)\r?\n?$", line)
    if not match:
        raise ValueError(f"Expected single-line `{key}` field")
    value = yaml.safe_load(match.group(1))
    return "" if value is None else str(value)


def yaml_quoted(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def update_note(path: Path, apply: bool) -> tuple[str, str]:
    raw = path.read_bytes()
    has_bom = raw.startswith(b"\xef\xbb\xbf")
    text = raw.decode("utf-8-sig")
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        raise ValueError("Missing opening YAML frontmatter delimiter")

    closing = next(
        (index for index, line in enumerate(lines[1:], start=1) if line.strip() == "---"),
        None,
    )
    if closing is None:
        raise ValueError("Missing closing YAML frontmatter delimiter")

    title_indexes = [
        index for index, line in enumerate(lines[1:closing], start=1) if line.startswith("title:")
    ]
    title_zh_indexes = [
        index
        for index, line in enumerate(lines[1:closing], start=1)
        if line.startswith("title_zh:")
    ]
    if len(title_indexes) != 1:
        raise ValueError(f"Expected one `title` field, found {len(title_indexes)}")
    if len(title_zh_indexes) > 1:
        raise ValueError(f"Expected at most one `title_zh` field, found {len(title_zh_indexes)}")

    title_index = title_indexes[0]
    title = scalar_from_line(lines[title_index], "title")
    title_zh = TRANSLATIONS.get(title)
    if title_zh is None:
        raise KeyError(f"No reviewed Chinese translation for title: {title}")

    newline = "\r\n" if lines[title_index].endswith("\r\n") else "\n"
    replacement = f"title_zh: {yaml_quoted(title_zh)}{newline}"
    current = ""
    if title_zh_indexes:
        title_zh_index = title_zh_indexes[0]
        current = scalar_from_line(lines[title_zh_index], "title_zh")
        lines[title_zh_index] = replacement
    else:
        lines.insert(title_index + 1, replacement)

    if apply and current != title_zh:
        output = "".join(lines).encode("utf-8")
        if has_bom:
            output = b"\xef\xbb\xbf" + output
        path.write_bytes(output)
    return current, title_zh


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Add or verify reviewed Chinese title_zh fields in source-note frontmatter."
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Write missing or outdated title_zh fields. Without this flag, only audit.",
    )
    args = parser.parse_args()

    paths = sorted(SOURCE_ROOT.glob("*.md"))
    discovered_titles: set[str] = set()
    changed = 0
    errors: list[str] = []

    for path in paths:
        try:
            text = path.read_text(encoding="utf-8-sig")
            title_match = re.search(r"^title:\s*(.*?)\r?$", text, re.MULTILINE)
            if title_match:
                title_value = yaml.safe_load(title_match.group(1))
                if title_value is not None:
                    discovered_titles.add(str(title_value))
            current, expected = update_note(path, args.apply)
            if current != expected:
                changed += 1
                action = "updated" if args.apply else "needs-update"
                print(f"{action}: {path.name}: {expected}")
        except (KeyError, ValueError, yaml.YAMLError) as exc:
            errors.append(f"{path.name}: {exc}")

    unused = sorted(set(TRANSLATIONS) - discovered_titles)
    for title in unused:
        errors.append(f"translation has no matching source note: {title}")

    print(
        f"source_notes={len(paths)} translations={len(TRANSLATIONS)} "
        f"changed={changed} errors={len(errors)} mode={'apply' if args.apply else 'audit'}"
    )
    for error in errors:
        print(f"ERROR: {error}")
    return 1 if errors or (not args.apply and changed) else 0


if __name__ == "__main__":
    raise SystemExit(main())
