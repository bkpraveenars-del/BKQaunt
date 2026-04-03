"""
BKQuant — industry-standard statistical reference (Python).

Uses:
  - statsmodels: OLS, ANOVA F-test, VIF (variance_inflation_factor), model AIC.
  - pingouin: pairwise Pearson/Spearman correlations with two-tailed p-values.

The browser app (app.js) implements parallel numerics; this module is the
ground-truth check for formulas (VIF definition, OLS sums of squares, F-test,
and correlation inference). Run ``python run_reference_checks.py`` to verify.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pingouin as pg
import statsmodels.api as sm
from scipy.stats import norm
from statsmodels.regression.linear_model import OLS
from statsmodels.stats.outliers_influence import variance_inflation_factor


# ---------------------------------------------------------------------------
# Correlation (phenotypic): Pearson r + two-tailed p-values (pingouin)
# ---------------------------------------------------------------------------


def pairwise_pearson_table(df: pd.DataFrame) -> pd.DataFrame:
    """
    Pairwise Pearson correlations with uncorrected two-tailed p-values.

    Pingouin uses scipy/stats patterns consistent with R cor.test for Pearson.
    """
    return pg.pairwise_corr(df, method="pearson", padjust="none")


def correlation_matrices(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Returns (R, P) where R[i,j] is r and P[i,j] is two-tailed p-value; diagonal NaN in P.
    """
    cols = list(df.columns)
    n = len(cols)
    R = pd.DataFrame(np.eye(n), index=cols, columns=cols)
    P = pd.DataFrame(np.nan, index=cols, columns=cols)
    pw = pairwise_pearson_table(df)
    for _, row in pw.iterrows():
        a, b = row["X"], row["Y"]
        R.loc[a, b] = R.loc[b, a] = row["r"]
        P.loc[a, b] = P.loc[b, a] = row["p-val"]
    return R, P


# ---------------------------------------------------------------------------
# Multiple linear regression — OLS (statsmodels)
# ---------------------------------------------------------------------------


def ols_fit(y: np.ndarray, X_predictors: np.ndarray):
    """
    OLS with intercept. X_predictors shape (n, p); statsmodels adds constant.

    Returns fitted statsmodels results; use .rsquared, .rsquared_adj, .fvalue, .f_pvalue, .aic.
    """
    X = np.asarray(X_predictors, dtype=float)
    y = np.asarray(y, dtype=float).ravel()
    Xc = sm.add_constant(X, has_constant="add")
    model = OLS(y, Xc)
    res = model.fit()
    return res


def vif_dataframe(X_predictors: pd.DataFrame) -> pd.DataFrame:
    """
    VIF per column — statsmodels variance_inflation_factor on *with-intercept* design.

    Industry standard matches R car::vif: VIF_j = 1 / (1 - R²_j) from regressing
    X_j on other predictors (including intercept).
    """
    X = np.asarray(X_predictors, dtype=float)
    Xc = sm.add_constant(X, has_constant="add")
    vifs = [variance_inflation_factor(Xc, i) for i in range(1, Xc.shape[1])]
    return pd.DataFrame({"predictor": list(X_predictors.columns), "VIF": vifs})


def vif_prune_iterative(
    df: pd.DataFrame,
    predictors: list[str],
    vif_max: float = 10.0,
) -> tuple[pd.DataFrame, list[tuple[str, float]]]:
    """
    Same rule as BKQuant app.js: while max(VIF) > vif_max, drop the predictor
    with the highest VIF. Returns (remaining_frame, removed_list).
    """
    removed: list[tuple[str, float]] = []
    cols = list(predictors)
    work = df[cols].copy()
    guard = 0
    while work.shape[1] > 0 and guard < 500:
        guard += 1
        vdf = vif_dataframe(work)
        mx = vdf["VIF"].max()
        j = int(vdf["VIF"].values.argmax())
        if not np.isfinite(mx) or mx <= vif_max:
            break
        worst = str(vdf.loc[j, "predictor"])
        removed.append((worst, float(mx)))
        work = work.drop(columns=[worst])
    return work, removed


def aic_gaussian_linear(n: int, sse: float, k_coeffs: int) -> float:
    """BKQuant JS AIC: n*ln(SSE/n) + 2*k (k = intercept + slopes)."""
    sse = max(float(sse), 1e-15)
    return n * np.log(sse / n) + 2 * k_coeffs


def stepwise_aic_bidirectional(
    X_pool: pd.DataFrame,
    y: np.ndarray,
    use_statsmodels_aic: bool = True,
) -> tuple[set[str], float, sm.regression.linear_model.RegressionResultsWrapper]:
    """
    Bidirectional stepwise on columns of X_pool (predictor names = columns).
    Minimizes AIC at each step (add/drop one), same search pattern as app.js.

    If use_statsmodels_aic=True, uses statsmodels OLSResults.aic (industry default).
    Else uses the Hastie-style formula aic_gaussian_linear for parity with JS.
    """
    names = list(X_pool.columns)
    active: set[str] = set(names)

    def fit_subset(cols: list[str]):
        if not cols:
            X = np.ones((len(y), 1))
            return OLS(y, X).fit()
        X = sm.add_constant(X_pool[list(cols)].values, has_constant="add")
        return OLS(y, X).fit()

    def get_aic(res: sm.regression.linear_model.RegressionResultsWrapper) -> float:
        if use_statsmodels_aic:
            return float(res.aic)
        sse = float(np.sum(res.resid**2))
        k = int(res.params.shape[0])
        return aic_gaussian_linear(len(y), sse, k)

    res = fit_subset(sorted(active))
    current_aic = get_aic(res)
    guard = 0
    while guard < 200:
        guard += 1
        best_aic = current_aic
        best_set: set[str] | None = None
        for j in list(active):
            nxt = set(active)
            nxt.remove(j)
            r = fit_subset(sorted(nxt))
            a = get_aic(r)
            if a < best_aic - 1e-9:
                best_aic = a
                best_set = nxt
        for j in names:
            if j in active:
                continue
            nxt = set(active)
            nxt.add(j)
            r = fit_subset(sorted(nxt))
            a = get_aic(r)
            if a < best_aic - 1e-9:
                best_aic = a
                best_set = nxt
        if best_set is None:
            break
        active = best_set
        res = fit_subset(sorted(active))
        current_aic = get_aic(res)
    return active, current_aic, res


# ---------------------------------------------------------------------------
# Path coefficients (standardized): P = inv(Rxx) @ rxy (same as app.js)
# ---------------------------------------------------------------------------


def path_standardized(R: np.ndarray, y_index: int, pred_indices: list[int]) -> tuple[np.ndarray, float]:
    """R full correlation among all traits; y_index column for response."""
    pidx = sorted(pred_indices)
    Rxx = R[np.ix_(pidx, pidx)]
    rxy = R[pidx, y_index]
    P = np.linalg.solve(Rxx, rxy)
    sum_rp = float(np.dot(rxy, P))
    residual_u = float(np.sqrt(max(0.0, min(1.0, 1.0 - sum_rp))))
    return P, residual_u


# ---------------------------------------------------------------------------
# Residuals for diagnostics (QQ / vs fitted use raw OLS residuals)
# ---------------------------------------------------------------------------


def residuals_qq_reference(residuals: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Order statistics vs normal quantiles (Blom-style p = (i-0.375)/(n+0.25))."""
    r = np.asarray(residuals, dtype=float).ravel()
    n = len(r)
    order = np.sort(r)
    i = np.arange(1, n + 1)
    p = (i - 0.375) / (n + 0.25)
    return norm.ppf(p), order


if __name__ == "__main__":
    # Minimal smoke test
    rng = np.random.default_rng(0)
    n = 30
    d = pd.DataFrame(
        {
            "x1": rng.normal(size=n),
            "x2": rng.normal(size=n),
            "y": rng.normal(size=n),
        }
    )
    d["y"] = 1.0 + 0.5 * d["x1"] - 0.3 * d["x2"] + rng.normal(scale=0.2, size=n)
    R, P = correlation_matrices(d)
    print("Correlation R:\n", R)
    print("VIF:\n", vif_dataframe(d[["x1", "x2"]]))
    res = ols_fit(d["y"].values, d[["x1", "x2"]].values)
    print(res.summary())
    print("AIC (statsmodels):", res.aic)
