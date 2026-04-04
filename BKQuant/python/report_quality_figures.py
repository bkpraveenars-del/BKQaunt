#!/usr/bin/env python3
"""
Publication-quality static figures for BKQuant reports (matplotlib + seaborn).

Use when you need journal-ready PNG/PDF from a CSV (e.g. exported means or raw data).
The in-browser app still renders interactive charts; this script is for print-quality output.

Examples:
  python report_quality_figures.py --csv means.csv --x genotype --y yield --kind bar --out fig_bar.png
  python report_quality_figures.py --csv traits.csv --x trait --y correlation --kind scatter --out fig_scatter.pdf
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="BKQuant high-DPI figures from CSV")
    parser.add_argument("--csv", required=True, type=Path, help="Input CSV path")
    parser.add_argument("--x", default="x", help="Column name for X / categories")
    parser.add_argument("--y", default="y", help="Column name for Y values")
    parser.add_argument("--hue", default=None, help="Optional grouping column (bar only)")
    parser.add_argument("--kind", choices=("bar", "line", "scatter"), default="bar")
    parser.add_argument("--out", type=Path, default=Path("bkq_figure.png"))
    parser.add_argument("--dpi", type=int, default=300)
    parser.add_argument("--title", default="", help="Figure title")
    parser.add_argument(
        "--style",
        default="seaborn-v0_8-whitegrid",
        help="matplotlib style (e.g. seaborn-v0_8-whitegrid, seaborn-v0_8-darkgrid, ggplot)",
    )
    args = parser.parse_args()

    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        import pandas as pd
        import seaborn as sns
    except ImportError as e:
        print("Install dependencies: pip install matplotlib seaborn pandas", file=sys.stderr)
        print(e, file=sys.stderr)
        return 1

    if not args.csv.is_file():
        print(f"File not found: {args.csv}", file=sys.stderr)
        return 1

    try:
        plt.style.use(args.style)
    except OSError:
        plt.style.use("seaborn-v0_8-whitegrid")

    plt.rcParams["figure.dpi"] = 300
    plt.rcParams["savefig.dpi"] = 300
    plt.rcParams["font.size"] = 12
    plt.rcParams["axes.titlesize"] = 13
    plt.rcParams["axes.labelsize"] = 12
    plt.rcParams["xtick.labelsize"] = 11
    plt.rcParams["ytick.labelsize"] = 11
    plt.rcParams["legend.fontsize"] = 10
    plt.rcParams["axes.grid"] = True
    plt.rcParams["grid.alpha"] = 0.35

    try:
        sns.set_theme(style="whitegrid", palette="deep", font_scale=1.05)
    except Exception:
        pass

    df = pd.read_csv(args.csv)
    if args.x not in df.columns or args.y not in df.columns:
        print(f"Columns missing. Have: {list(df.columns)}", file=sys.stderr)
        return 1

    fig, ax = plt.subplots(figsize=(9, 5.2))
    title = args.title or f"{args.y} vs {args.x}"

    if args.kind == "bar":
        if args.hue and args.hue in df.columns:
            sns.barplot(data=df, x=args.x, y=args.y, hue=args.hue, ax=ax, palette="deep", edgecolor="0.15")
            ax.legend(title=args.hue, frameon=True)
        else:
            sns.barplot(data=df, x=args.x, y=args.y, ax=ax, color="#0f766e", edgecolor="0.2")
    elif args.kind == "line":
        sns.lineplot(data=df, x=args.x, y=args.y, ax=ax, marker="o", linewidth=2.2, color="#1d4ed8")
    else:
        sns.scatterplot(data=df, x=args.x, y=args.y, ax=ax, s=55, alpha=0.85, edgecolor="0.25", color="#b91c1c")

    ax.set_title(title, fontsize=13, fontweight="600", pad=12)
    ax.set_xlabel(args.x.replace("_", " "), fontsize=11)
    ax.set_ylabel(args.y.replace("_", " "), fontsize=11)
    plt.xticks(rotation=35, ha="right")
    fig.tight_layout()

    out = args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(out, dpi=args.dpi, bbox_inches="tight", facecolor="white")
    plt.close(fig)
    print(f"Wrote {out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
