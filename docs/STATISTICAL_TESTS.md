# How Morphly calculates statistics

This file says exactly what Morphly does when it puts a p-value on your
figure: which formula, which assumptions, which reference implementation it was
checked against, and where the code and its tests live.

It is written for two readers. If you are **using** Morphly, it lets you check
that the test on your figure is the one you would have run yourself, and quote
it in a methods section. If you are **working on** Morphly, it is the index to
come back to when a result looks wrong: every test names its file, its function
and its test, so a suspected error can be traced in one step.

**Nothing here is hidden.** Morphly computes the test statistic from the
textbook formula, takes the p-value from a published distribution function, and
recomputes the whole thing from your data every time the graph is drawn.
Results are never stored, so a graph and its statistics cannot disagree.

Last checked against **R 4.6.1** (with `car` and `rstatix`) and **SciPy 1.18**.
Morphly version: **0.5**.

## Contents

- [How to read this file](#how-to-read-this-file)
- [Index of every test](#index-of-every-test)
- [Descriptive statistics](#descriptive-statistics)
- [Comparing two groups](#comparing-two-groups)
- [Comparing three or more groups](#comparing-three-or-more-groups)
- [Counts in categories](#counts-in-categories)
- [Two factors at once](#two-factors-at-once)
- [Checking the assumptions](#checking-the-assumptions)
- [How Morphly chooses a test for you](#how-morphly-chooses-a-test-for-you)
- [Multiple comparisons](#multiple-comparisons)
- [Effect sizes](#effect-sizes)
- [Outliers](#outliers)
- [Correlation and straight lines](#correlation-and-straight-lines)
- [Fitting a curve](#fitting-a-curve)
- [Survival curves](#survival-curves)
- [SuperPlots: replicates, not cells](#superplots-replicates-not-cells)
- [Distributions: violins, histograms and density](#distributions-violins-histograms-and-density)
- [How p-values are written](#how-p-values-are-written)
- [What Morphly does not do yet](#what-morphly-does-not-do-yet)
- [Checking a result yourself](#checking-a-result-yourself)
- [If you think a result is wrong](#if-you-think-a-result-is-wrong)

## How to read this file

Every test has the same four facts:

- **Used when**: the data shape and the choice that leads Morphly here.
- **What it computes**: the statistic, in words.
- **Checked against**: the reference implementation whose numbers the tests
  compare with, digit for digit.
- **Code**: the file and function, and the test that pins it down.

Paths are relative to the repository root. `app/src/renderer/lib/stats.js`
holds the mathematics, `app/src/renderer/lib/analysis.js` decides which test to
run and how to correct it, and the files ending in `.test.js` beside them hold
the checks.

## Index of every test

| Test | Used when | Checked against | Code | Test |
|---|---|---|---|---|
| Unpaired t test | 2 groups, equal spread | `t.test(x, y, var.equal = TRUE)` | `stats.js` `tTest` | `stats.test.js` |
| Welch's t test | 2 groups, unequal spread | `t.test(x, y)` | `stats.js` `tTest` | `stats.test.js` |
| Paired t test | 2 groups, rows matched | `t.test(x, y, paired = TRUE)` | `stats.js` `pairedTTest` | `stats.test.js` |
| Mann-Whitney | 2 groups, not normal | `wilcox.test(x, y)` | `stats.js` `mannWhitney` | `stats.test.js` |
| Wilcoxon signed rank | 2 matched groups, not normal | `wilcox.test(paired = TRUE)` | `stats.js` `wilcoxonSignedRank` | `stats.test.js` |
| One-way ANOVA | 3+ groups, equal spread | `aov()` | `stats.js` `oneWayAnova` | `stats.test.js` |
| Tukey's test | after one-way ANOVA | `TukeyHSD()` | `stats.js` `tukeyHsd` | `stats.test.js` |
| Welch's ANOVA | 3+ groups, unequal spread | `oneway.test(var.equal = FALSE)` | `stats.js` `welchAnova` | `stats.test.js` |
| Games-Howell | after Welch's ANOVA | `rstatix::games_howell_test()` | `stats.js` `gamesHowell` | `stats.test.js` |
| Kruskal-Wallis | 3+ groups, not normal | `kruskal.test()` | `stats.js` `kruskalWallis` | `stats.test.js` |
| Dunn's test | after Kruskal-Wallis | `rstatix::dunn_test()` | `stats.js` `dunnTest` | `stats.test.js` |
| Repeated measures ANOVA | 3+ matched groups | `aov(v ~ g + Error(subject/g))` | `stats.js` `repeatedMeasuresAnova` | `stats.test.js` |
| Friedman | 3+ matched groups, not normal | `friedman.test()` | `stats.js` `friedman` | `stats.test.js` |
| Two-way ANOVA | groups by condition | `car::Anova(type = "II")` | `stats.js` `twoWayAnova` | `stats.test.js` |
| Fisher's exact test | 2 by 2 counts | `fisher.test()` | `stats.js` `fisherExact` | `stats.test.js` |
| Chi-square | counts, any size | `chisq.test()` | `stats.js` `chiSquareTest` | `stats.test.js` |
| McNemar | paired counts | `mcnemar.test()` | `stats.js` `mcnemarTest` | `stats.test.js` |
| Cochran-Armitage | trend across ordered rows | `prop.trend.test()` | `stats.js` `trendTest` | `stats.test.js` |
| D'Agostino-Pearson | normality check | `scipy.stats.normaltest()` | `stats.js` `dAgostinoPearson` | `stats.test.js` |
| Anderson-Darling | normality check | `scipy.stats.anderson()` | `stats.js` `andersonDarling` | `stats.test.js` |
| Grubbs | outlier note | the standard formula | `stats.js` `grubbsTest` | `stats.test.js` |
| Cohen's d, Hedges' g | effect size, two groups | `rstatix::cohens_d()` | `stats.js` `effectSizeD` | `stats.test.js` |
| Omega squared | effect size, ANOVA | the standard formula | `stats.js` `omegaSquared` | `stats.test.js` |
| Benjamini-Hochberg | multiple comparisons | `p.adjust(method = "BH")` | `stats.js` `adjustBenjaminiHochberg` | `stats.test.js` |
| Kendall's tau-b | correlation | `cor.test(method = "kendall")`, SciPy | `stats.js` `kendall` | `stats.test.js` |
| Skewness, kurtosis | descriptive | `scipy.stats.skew(bias = False)` | `stats.js` `shape` | `stats.test.js` |
| Geometric mean, CV | descriptive | `scipy.stats.gmean()` | `stats.js` `geometricMean` | `stats.test.js` |
| Dunnett's test | every group against one control | simulation (see below) | `stats.js` `dunnettTest` | `stats.test.js` |
| Shapiro-Wilk | normality check | `shapiro.test()` | `stats.js` `shapiroWilk` | `stats.test.js` |
| Brown-Forsythe | equal spread check | `car::leveneTest(center = median)` | `stats.js` `brownForsythe` | `stats.test.js` |
| Pearson correlation | X and Y graphs | `cor.test()` | `stats.js` `pearson` | `stats.test.js` |
| Spearman correlation | X and Y graphs | `scipy.stats.spearmanr()` | `stats.js` `spearman` | `stats.test.js` |
| Linear regression | X and Y graphs | `lm(y ~ x)` | `stats.js` `linearRegression` | `stats.test.js` |
| Four-parameter dose response | IC50 or EC50 from a dose curve | `nls()` | `curveFit.js` `MODELS["4pl"]` | `curveFit.test.js` |
| Exponential decay, association | a signal that falls or rises to a plateau | `nls()` | `curveFit.js` `MODELS` | `curveFit.test.js` |
| Michaelis-Menten | enzyme kinetics | `nls()` | `curveFit.js` `MODELS` | `curveFit.test.js` |
| Extra sum of squares F test | is a richer curve worth its parameters | the standard formula | `curveFit.js` `compareFits` | `curveFit.test.js` |
| Kaplan-Meier | survival over time, with censoring | `survfit()` | `survival.js` `kaplanMeier` | `survival.test.js` |
| Log-rank (Mantel-Cox) | comparing survival curves | `survdiff()` | `survival.js` `compareSurvival` | `survival.test.js` |
| Gehan-Breslow-Wilcoxon | comparing curves, early times weighted | `survdiff(rho = 1)` in spirit | `survival.js` `compareSurvival` | `survival.test.js` |
| Hazard ratio | two survival curves | the O over E formula | `survival.js` `compareSurvival` | `survival.test.js` |
| Holm's correction | multiple comparisons | `p.adjust(method = "holm")` | `stats.js` `adjustHolm` | `stats.test.js` |
| Bonferroni | multiple comparisons | `p.adjust(method = "bonferroni")` | `stats.js` `adjustBonferroni` | `stats.test.js` |
| Šídák | multiple comparisons | the formula below | `analysis.js` `correctPValues` | `analysis.test.js` |
| Kernel density | violins and density curves | `density(kernel = "gaussian")` | `stats.js` `kernelDensity` | `stats.test.js` |
| Histogram bins | histograms | Freedman-Diaconis, rounded | `stats.js` `histogramBins` | `stats.test.js` |

## Descriptive statistics

`stats.js` `describe` computes, for each column: **n**, **mean**, **standard
deviation** (dividing by n minus 1), **standard error** (SD over the square
root of n), the **95% confidence interval of the mean** (t at 0.975 with n
minus 1 degrees of freedom, times the standard error), the **median**, the
**first and third quartiles**, the **smallest** and the **largest** value.

**More statistics**, the button in the data table, adds the median, the SEM,
the 95% confidence interval, the **geometric mean** (only when every value is
above zero), the **coefficient of variation** as a percentage of the mean, and
**skewness and kurtosis**: the bias-corrected G1 and G2 that Excel, SPSS and
Prism report, and that SciPy gives with `bias = False`.

Quartiles use R's default method (type 7), which is the same as
`quantile(x, 0.25)` in R and `numpy.percentile` with linear interpolation.
Prism uses a different quartile rule for some plots, so a box drawn here can
sit a hair away from the same box in Prism when n is small.

## Comparing two groups

### Unpaired and Welch's t tests

- **Used when**: two groups. Morphly suggests the unpaired test when the
  spreads are similar and Welch's when they are not; either can be chosen by
  hand.
- **What it computes**: the difference between means over its standard error.
  The unpaired version pools the two variances and has n1 plus n2 minus 2
  degrees of freedom. Welch's version does not pool, and its degrees of freedom
  come from the Welch-Satterthwaite formula, so they are usually fractional.
- **p-value**: two-sided, from the t distribution.
- **Checked against**: `t.test(x, y, var.equal = TRUE)` and `t.test(x, y)`.

### Paired t test

- **Used when**: two groups with **Paired** ticked, meaning each row is one
  subject measured twice.
- **What it computes**: a one-sample t test on the differences within each row.
  Rows missing either value are left out, and Morphly says how many.
- **Checked against**: `t.test(x, y, paired = TRUE)`.

### Mann-Whitney test

- **Used when**: two groups whose values do not look normal.
- **What it computes**: the rank sum statistic W (equal to the U statistic for
  the first group). **Below 50 values per group the p-value is exact**,
  counted from the conditional distribution of the rank sum, which stays exact
  when values are tied. From 50 upwards it uses the normal approximation with
  a continuity correction and a correction for ties.
- **Checked against**: `wilcox.test(x, y)` in R 4.6, which changed in that
  version to use the exact conditional distribution with ties. Older R gives
  the normal approximation in that case, so an old R session and Morphly can
  differ on tied data; Morphly follows the newer, more exact behaviour.

### Wilcoxon signed rank test

- **Used when**: two matched groups whose differences do not look normal.
- **What it computes**: V, the sum of ranks of the positive differences. Below
  50 pairs the p-value is exact, with zero differences kept in the ranking as
  R 4.6 does. From 50 pairs upwards it uses the normal approximation with
  continuity and tie corrections, and zero differences are dropped.
- **Checked against**: `wilcox.test(x, y, paired = TRUE)`.

## Comparing three or more groups

### One-way ANOVA and Tukey's test

- **What it computes**: the ratio of the variation between groups to the
  variation within them, with k minus 1 and N minus k degrees of freedom, plus
  eta squared as an effect size. Tukey's test then compares every pair using
  the pooled spread, and its p-value comes from the studentized range
  distribution, which allows for the number of groups being compared.
- **Checked against**: `aov()` and `TukeyHSD()`.

### Welch's ANOVA and Games-Howell

- **Used when**: three or more groups whose spreads differ.
- **What it computes**: Welch's F, which weights each group by n over its own
  variance, with fractional degrees of freedom. Games-Howell then compares
  pairs without pooling, each with its own Welch degrees of freedom, and takes
  its p-value from the studentized range.
- **Checked against**: `oneway.test(var.equal = FALSE)` and
  `rstatix::games_howell_test()`.

### Kruskal-Wallis and Dunn's test

- **What it computes**: H, from the rank sums of each group, corrected for
  ties, compared with a chi-square distribution on k minus 1 degrees of
  freedom. Dunn's test compares pairs of mean ranks, using the tie-corrected
  variance, and the p-values are then corrected by Holm.
- **Checked against**: `kruskal.test()` and
  `rstatix::dunn_test(p.adjust.method = "holm")`.

### Repeated measures ANOVA and Friedman

- **Used when**: three or more matched groups (**Paired** ticked).
- **What it computes**: the repeated measures ANOVA splits the variation into
  subject, condition and residual, and assumes sphericity (no correction is
  applied). Friedman ranks within each row and compares the column rank sums,
  corrected for ties.
- **Follow-up comparisons**: paired t tests (after the ANOVA) or Wilcoxon
  signed rank tests (after Friedman), Holm corrected.
- **Checked against**: `aov(v ~ cond + Error(subject/cond))`,
  `friedman.test()`, `pairwise.t.test(paired = TRUE)`.

## Two factors at once

### Two-way ANOVA

- **Used when**: the "groups by condition" data shape, where the first column
  names each row's group and every other column is a condition.
- **What it computes**: the effect of each factor and of their interaction.
  The sums of squares come from comparing nested models fitted by least
  squares (`lib/linearModel.js`), not from sums over cells, so they stay
  correct when cells hold different numbers of values.
- **Which sums of squares**: **type II**. Each main effect is judged against a
  model holding the other one, and the interaction against both main effects.
  Type II does not depend on which factor is named first. When every cell holds
  the same number of values, type I, II and III all agree, and all agree with
  R's `aov()`.
- **Checked against**: `car::Anova(lm(v ~ a * b), type = "II")`, for an even
  design and an uneven one.

### Comparisons on a grouped graph

Pairs are compared with the pooled spread from the ANOVA, as Prism does, so
they agree with the table above them. Which pairs, and how the p-values are
corrected, are set in **Advanced statistics**:

- conditions within each group (the default),
- groups within each condition,
- every condition against one chosen condition.

## Counts in categories

The "counts in categories" data shape holds one count per cell: the first
column names each row, every other column is a category.

### Fisher's exact test

- **Used when**: a 2 by 2 table. It is the suggestion there, since it is exact
  however small the counts.
- **What it computes**: the sum of the probabilities of every table no more
  likely than the one observed, with the row and column totals held fixed.
  Two-sided, as R does it.
- **Odds ratio**: the simple cross-product, with Woolf's 95% interval on the
  log odds ratio. R reports a conditional maximum likelihood estimate instead,
  so R's odds ratio can differ slightly while the p-value agrees.
- **Checked against**: `fisher.test()`.

### Chi-square test of independence

- **Used when**: any table; the suggestion for anything larger than 2 by 2.
- **What it computes**: the usual sum over cells of the squared difference
  between the observed and expected count, over the expected count, on
  (rows minus 1) times (columns minus 1) degrees of freedom.
- **Yates' correction** is applied to 2 by 2 tables, as R does by default, and
  can be turned off.
- **Warning**: Morphly reports the smallest expected count and warns below 5,
  where the approximation starts to slip and Fisher's test is the better
  choice.
- **Checked against**: `chisq.test()` with and without the correction, and on
  a 3 by 3 table.

### McNemar's test

- **Used when**: the same subjects counted twice (before and after, or two
  tests on the same samples). Only the pairs that changed carry information.
- **Checked against**: `mcnemar.test()`, with and without the continuity
  correction.

### Cochran-Armitage test for trend

- **Used when**: two categories across ordered rows, asking whether the share
  rises or falls across them. Scores are 1, 2, 3 and so on by default.
- **Checked against**: `prop.trend.test()`.

## Checking the assumptions

### Shapiro-Wilk (normality)

- **What it computes**: Royston's algorithm (AS R94), the same one R uses.
- **When Morphly runs it**: only when every sample holds at least **five**
  values. Below that a normality test has almost no power, and acting on it
  does harm: three replicates would be sent to a rank test that cannot reach
  significance at all, whatever the difference. With fewer than five values
  Morphly assumes normality and says so in the reason line.
- **What it is used for**: choosing between a t test or ANOVA and their rank
  based counterparts. It never blocks anything; you can always choose the test
  yourself.
- **Checked against**: `shapiro.test()`, from 3 to 30 values.

### D'Agostino-Pearson and Anderson-Darling

Two other normality tests can be chosen in Advanced statistics:

- **D'Agostino-Pearson** combines skewness and kurtosis, each turned into a
  standard normal and squared. It needs at least 8 values. This is what Prism
  calls the omnibus test. Checked against `scipy.stats.normaltest()`.
- **Anderson-Darling** weighs the tails of the distribution more heavily, which
  makes it good at catching heavy tails. The statistic matches
  `scipy.stats.anderson()`; its p-value comes from the published approximation
  (D'Agostino and Stephens 1986), the same one `nortest::ad.test` reports, so
  it is accurate to about two decimal places rather than exactly.

### Brown-Forsythe (equal spread)

- **What it computes**: a one-way ANOVA on the distances of each value from
  its own group's median. Using the median rather than the mean is what makes
  it Brown-Forsythe rather than Levene's original test, and it is what
  `car::leveneTest` does by default.
- **What it is used for**: choosing between the pooled and the Welch versions
  of the t test and ANOVA.
- **Checked against**: `car::leveneTest(v ~ g, center = median)`.

## How Morphly chooses a test for you

The suggested test, and the sentence explaining it, come from
`analysis.js` `suggest`:

1. **Are the values normal?** Shapiro-Wilk on every group (or on the
   differences, for two matched groups), when each holds at least five values.
   If any group gives p at or below 0.05, the answer is no.
2. **Are the spreads similar?** Brown-Forsythe, for unmatched groups only.
3. Then:

| Groups | Matched | Normal | Spreads | Suggested |
|---|---|---|---|---|
| 2 | no | yes | similar | Unpaired t test |
| 2 | no | yes | differ | Welch's t test |
| 2 | no | no | any | Mann-Whitney |
| 2 | yes | yes | any | Paired t test |
| 2 | yes | no | any | Wilcoxon signed rank |
| 3+ | no | yes | similar | One-way ANOVA with Tukey |
| 3+ | no | yes | differ | Welch's ANOVA with Games-Howell |
| 3+ | no | no | any | Kruskal-Wallis with Dunn |
| 3+ | yes | yes | any | Repeated measures ANOVA |
| 3+ | yes | no | any | Friedman |

The suggestion is a starting point, not a ruling. Everything can be overridden,
and the reason is always written out, so a reviewer can see why that test was
used.

## Multiple comparisons

| Method | Formula | Where |
|---|---|---|
| Holm | step down: each p times the number of tests left, kept increasing | after Dunn's test and paired follow-ups |
| Bonferroni | p times the number of comparisons | offered on grouped graphs |
| Šídák | 1 minus (1 minus p) to the power of the number of comparisons | the default on grouped graphs |
| Benjamini-Hochberg | the share of false positives among those called significant, rather than the chance of any at all | offered on grouped graphs, and the usual choice when there are many comparisons |
| Tukey | studentized range across the means in the family | after one-way ANOVA, and offered on grouped graphs |
| None | p as it came | offered, but honest only for a single comparison planned in advance |

The correction applies to the family of comparisons Morphly actually draws.

### Dunnett's test

- **Used when**: every group is compared with one control.
- **What it computes**: the probability that the largest of several correlated
  t statistics exceeds the one observed. The comparisons are correlated because
  they share the control. Conditional on the control's own deviation and on the
  pooled spread they become independent, which turns the probability into a
  double integral, evaluated by Gauss-Legendre quadrature in panels.
- **Checked against**: **a simulation of 40 million draws**, not SciPy.
  `scipy.stats.dunnett` agrees for large p but drifts in the tails, where its
  own documentation calls its p-values approximate. At t = 6.467 with four
  groups of six, the simulation gives 7.7e-06 (95% interval 6.9e-06 to
  8.6e-06), Morphly gives 7.6e-06 and SciPy gives 4.5e-06. The simulation code
  and its numbers are recorded in `stats.test.js`.

## Effect sizes

A p-value says whether a difference is distinguishable from chance; an effect
size says how large it is. Morphly reports one beside the test:

- **Cohen's d** for two groups, using the pooled spread, with **Hedges' g**
  (the small-sample correction) and its 95% confidence interval. Labelled
  negligible, small, medium or large at the usual 0.2, 0.5 and 0.8.
  Checked against `rstatix::cohens_d()`.
- **Eta squared and omega squared** for a one-way ANOVA: the share of the
  variation the groups explain. Omega squared removes the bias in eta squared,
  so it is a little smaller and the better one to quote.

## Outliers

Morphly runs **Grubbs' test** on each group of six values or more and, if one
value stands out, says so in a warning that names the value and its p-value.

**It never removes anything.** Dropping a measurement is a decision about the
experiment, not about the arithmetic: the right question is whether that well
was contaminated or that reading mistyped, which no test can answer. The note
exists to prompt that check.

## Correlation and straight lines

On an X and Y graph, each Y series is compared with X:

- **Linear regression** (`linearRegression`): slope, intercept, R squared,
  the standard error of the slope, and a two-sided p for the slope differing
  from zero. Checked against `lm(y ~ x)`.
- **Pearson correlation**: r, with a t test on n minus 2 degrees of freedom.
  Checked against `cor.test()`.
- **Spearman correlation**: Pearson's r on the ranks, with the same t
  approximation SciPy uses. Checked against `scipy.stats.spearmanr`. R's
  `cor.test(method = "spearman")` computes an exact p for small samples
  without ties, so R and Morphly can differ slightly there.
- **Kendall's tau-b**, which allows for ties, with a normal approximation for
  the p-value. Checked against `cor.test(method = "kendall")` and
  `scipy.stats.kendalltau(method = "asymptotic")`. R computes an exact p for
  small samples without ties, so the two differ slightly there, in the same
  way as Spearman.

## Fitting a curve

An X and Y graph can carry a fitted curve as well as a straight line. The fit
is **least squares by Levenberg-Marquardt** (`curveFit.js` `fitCurve`), which
is the same criterion `nls()` and Prism use, so the parameters agree with both.

The models are:

| Model | Equation | What it gives you |
|---|---|---|
| Dose response (four parameters) | Bottom + (Top - Bottom) / (1 + (IC50 / X) ^ Hill) | IC50 or EC50, Hill slope |
| Exponential decay | Plateau + (Y0 - Plateau) e^(-k X) | rate, half life |
| One-phase association | Y0 + (Plateau - Y0) (1 - e^(-k X)) | rate, half time |
| Michaelis-Menten | Vmax X / (Km + X) | Vmax, Km |

Starting values are worked out from the points themselves (the dose nearest
the half way point is the first guess at the IC50, and so on), so nothing has
to be guessed by hand. The fit still finds the same answer from a deliberately
poor start; there is a test for that.

**The uncertainty matters as much as the estimate.** After the fit, the
covariance of the parameters is the inverse of the Jacobian's cross-product
times the residual mean square. From it come:

- the **standard error** of each parameter,
- its **95% confidence interval**, as estimate plus or minus t(0.975, n - p)
  standard errors, which is what `confint.default()` gives and what Prism
  calls the asymptotic interval, and
- the **confidence band** drawn around the curve: at each X, the standard
  error of the curve is the gradient of the model there, sandwiched with the
  covariance matrix. It is deliberately widest where there are no points.

Parameters and intervals were checked against R's `nls()`: for the test dose
response, an IC50 of 1.04746 against R's 1.0474575582, and standard errors
within 2%. Standard errors are themselves approximations, which is why the
tolerance there is looser than elsewhere in this file.

`compareFits` runs the **extra sum of squares F test**, which asks whether a
richer model earns its extra parameters:

F = ((RSS_simple - RSS_rich) / (df_simple - df_rich)) / (RSS_rich / df_rich)

This is how Prism asks whether two dose response curves share an IC50.

A curve is a fit, not a test. If the points do not cover the top or the bottom
of a dose response, the IC50 can be precise and still wrong, and the interval
will not warn you: it describes the fit, not whether the model was right.

## Survival curves

Survival data has a shape of its own: each subject has a **time** and an
**event** flag, where 1 means the event happened and 0 means the subject was
censored (they left the study, or the study ended, while still event-free).
A censored subject is not a missing value: they tell us they lasted at least
that long, and dropping them biases the result.

**Kaplan-Meier** (`survival.js` `kaplanMeier`): at each time an event happens,
survival is multiplied by (1 - events / at risk). The curve steps down only at
events, and stays flat at a censoring, where a tick is drawn instead. Median
survival is the first time the curve reaches or passes a half; when it never
falls that far, Morphly says "not reached" rather than inventing a number.

**Log-rank (Mantel-Cox)** (`compareSurvival`): at each event time, the events
in each group are compared with how many would be expected if the groups were
alike, and the differences are added up and divided by their variance. Every
time counts equally. Checked against `survdiff()`: chi-square 18.3784 on 1
degree of freedom for the test data, with the expected counts 2.58213 and
11.41787 matching to six figures.

**Gehan-Breslow-Wilcoxon**: the same sum, with each time weighted by how many
are still at risk. That weights early differences more heavily, which suits
curves that separate early and then come back together. Choose it in the
Statistics section when that is what you mean; the log-rank test is what most
papers report, and is the default.

**Hazard ratio**, for two groups: (O1 / E1) / (O2 / E2), with the interval
from a standard error of the square root of (1 / E1 + 1 / E2). This is the
log-rank estimate, the one Prism reports, not a Cox regression. Cox regression
with covariates is not in Morphly yet.

A group with no events at all cannot be compared properly, and Morphly says so
rather than printing a p-value that means nothing.

## SuperPlots: replicates, not cells

A SuperPlot draws every measurement coloured by which biological replicate it
came from, with each replicate's mean marked, and the mean and spread taken
**across the replicate means**.

The statistics follow the same rule, which is the whole point of the plot:
cells within one dish are not independent, so testing hundreds of them claims
far more certainty than the experiment earned. Morphly averages each replicate
(`datasets.js` `replicateMeans`), then runs a **paired** test on those means,
paired because the same replicates appear in every condition. With three
replicates, that is a paired t test on three pairs.

## Distributions: violins, histograms and density

- **Kernel density** (violins, density curves): a Gaussian kernel at each
  value. The bandwidth is R's `bw.nrd0`: 0.9 times the smaller of the standard
  deviation and the interquartile range over 1.34, times n to the power of
  minus one fifth. Checked against R's `density(kernel = "gaussian")`; Morphly
  evaluates the kernel exactly where R bins and uses an FFT, so the two agree
  to a few parts in ten thousand and Morphly is the more precise.
- **Violin shape**: the density, mirrored, cut off at the smallest and largest
  value, with a line at the median.
- **Histogram bins**: the Freedman-Diaconis width (twice the interquartile
  range over the cube root of n), rounded to 1, 2, 2.5 or 5 times a power of
  ten so the edges read well, falling back to Sturges' rule when the values are
  too alike. A bin width can be set by hand in Advanced axes.

## How p-values are written

- Below 0.0001: `p < 0.0001`.
- Below 0.1: four decimal places, so 0.0495 is not rounded to 0.05.
- Otherwise: two decimal places.
- Stars follow GraphPad's scheme: `*` p < 0.05, `**` p < 0.01, `***`
  p < 0.001, `****` p < 0.0001, `ns` otherwise.

## What Morphly does not do yet

Mixed models, ANCOVA, Cox regression with covariates, two-way repeated
measures, sphericity corrections (Greenhouse-Geisser), shared-parameter curve
fitting across data sets, and equivalence testing.

The ones that need a full modelling engine are meant for an optional
statistics download rather than for the app itself.

## Checking a result yourself

Every number on a Morphly figure can be reproduced in R. Export your data as
CSV from the data table, then:

```r
d <- read.csv("data.csv")
t.test(d$Control, d$Treated, var.equal = TRUE)   # unpaired t test
wilcox.test(d$Control, d$Treated)                 # Mann-Whitney
summary(aov(value ~ group, long))                 # one-way ANOVA
TukeyHSD(aov(value ~ group, long))                # Tukey
car::Anova(lm(value ~ genotype * treatment, long), type = "II")  # two-way

# a dose response curve, and survival
nls(y ~ bottom + (top - bottom) / (1 + (ic50 / x)^hill), d,
    start = list(bottom = 0, top = 100, ic50 = 1, hill = 1))
library(survival)
survfit(Surv(time, event) ~ group, d)
survdiff(Surv(time, event) ~ group, d)
```

To run Morphly's own checks, which compare against numbers R produced:

```bash
cd app
npm test
```

## If you think a result is wrong

Please say so: a wrong p-value in a published figure is worse than a missing
feature. Open an issue at
[github.com/SAADAT-Abu/Morphly/issues](https://github.com/SAADAT-Abu/Morphly/issues)
with:

1. the numbers (a small CSV, or the values typed out),
2. what Morphly showed,
3. what you expected, and from which program or textbook,
4. the version of Morphly, from Help, About.

If you can, include the R or Python command you compared against. That turns a
report into a test, and the test into a fix.
