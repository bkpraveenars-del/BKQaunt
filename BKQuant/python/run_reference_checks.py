#!/usr/bin/env python3
"""Run industry_standard_stats against a fixed toy dataset; use to validate BKQuant JS outputs."""

import numpy as np
import pandas as pd

from industry_standard_stats import (
    aic_gaussian_linear,
    correlation_matrices,
    ols_fit,
    pairwise_pearson_table,
    path_standardized,
    residuals_qq_reference,
    stepwise_aic_bidirectional,
    vif_dataframe,
    vif_prune_iterative,
)


def main():
    rng = np.random.default_rng(42)
    n = 24
    df = pd.DataFrame(
        {
            "N": rng.uniform(10, 20, n),
            "P": rng.uniform(15, 25, n),
            "K": rng.uniform(38, 50, n),
        }
    )
    df["Yield"] = 2.0 + 0.08 * df["N"] + 0.05 * df["P"] + 0.02 * df["K"] + rng.normal(0, 0.15, n)

    print("=== pingouin / pairwise Pearson ===")
    print(pairwise_pearson_table(df))

    print("\n=== R and P matrices ===")
    R, P = correlation_matrices(df)
    print("R:\n", R)
    print("P (off-diag p-values):\n", P)

    print("\n=== statsmodels OLS (Yield ~ N + P + K) ===")
    y = df["Yield"].values
    X = df[["N", "P", "K"]].values
    res = ols_fit(y, X)
    print(res.summary())
    print("R2, R2_adj, F, F_pvalue:", res.rsquared, res.rsquared_adj, res.fvalue, res.f_pvalue)
    print("AIC (statsmodels):", res.aic)
    sse = float(np.sum(res.resid**2))
    k = res.params.shape[0]
    print("AIC (Hastie / BKQuant JS style):", aic_gaussian_linear(len(y), sse, k))

    print("\n=== VIF (statsmodels) ===")
    print(vif_dataframe(df[["N", "P", "K"]]))

    print("\n=== VIF prune (max 10) ===")
    rem, dropped = vif_prune_iterative(df, ["N", "P", "K"], vif_max=10.0)
    print("Remaining columns:", list(rem.columns))
    print("Removed:", dropped)

    print("\n=== Stepwise AIC (statsmodels.aic) ===")
    active, aic, res_s = stepwise_aic_bidirectional(df[["N", "P", "K"]], y, use_statsmodels_aic=True)
    print("Active:", sorted(active), "AIC:", aic)

    print("\n=== Path (standardized) — correlation submatrix ===")
    Rm = R.values
    cols = list(df.columns)
    yi = cols.index("Yield")
    pred = [cols.index(c) for c in ["N", "P", "K"]]
    Pcoef, u = path_standardized(Rm, yi, pred)
    print("Path coeffs:", Pcoef, "Residual U:", u)

    print("\n=== Q-Q reference quantiles (first 3) ===")
    theo, samp = residuals_qq_reference(res.resid)
    print("theoretical[:3]", theo[:3], "ordered resid[:3]", samp[:3])

    print("\nOK — reference run finished.")


if __name__ == "__main__":
    main()
