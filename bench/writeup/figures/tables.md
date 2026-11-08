# Figures and tables

Made by `writeup/figures.ts`; do not edit by hand.

## review-verify: the summary

### Per problem: mean (min–max) over complete runs

| configuration | problem | runs | solved | Core | reliable | erosion | verbosity | $ | seconds |
|---|---|---|---|---|---|---|---|---|---|
| baseline | datagate | 3 | 0.619 (0.571–0.714) | 0.925 (0.909–0.956) | 0 | 0.59 (0.438–0.69) | 0.252 (0.206–0.316) | 2.652 (2.592–2.702) | 685.571 (655.275–710.216) |
| baseline | textdrop | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.712 (0.676–0.739) | 0.227 (0.213–0.251) | 2.976 (2.746–3.188) | 800.298 (749.822–860.645) |
| baseline | file_query_tool | 3 | 0.8 (0.6–1) | 0.984 (0.963–1) | 0.333 | 0.835 (0.8–0.856) | 0.347 (0.314–0.373) | 5.918 (5.729–6.077) | 1502.185 (1447.639–1586.044) |
| baseline | mvvault | 3 | 0.833 (0.833–0.833) | 0.973 (0.967–0.985) | 0 | 0.61 (0.578–0.668) | 0.53 (0.473–0.572) | 3.254 (3.079–3.358) | 804.251 (769.78–851.651) |
| baseline | meshctl | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.704 (0.693–0.71) | 0.418 (0.348–0.482) | 4.024 (3.832–4.269) | 924.463 (895.674–947.882) |
| baseline | eve_industry | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.773 (0.688–0.843) | 0.287 (0.255–0.324) | 3.555 (3.366–3.762) | 927.072 (838.708–1004.454) |
| baseline | layered_config_synthesizer | 3 | 0 (0–0) | 0.176 (0.111–0.255) | 0 | 0.697 (0.666–0.72) | 0.412 (0.298–0.524) | 2.365 (2.161–2.57) | 597.979 (557.238–646.471) |
| baseline | eve_market_tools | 3 | 0.25 (0.25–0.25) | 0.502 (0.419–0.544) | 0 | 0.77 (0.757–0.781) | 0.332 (0.289–0.357) | 3.448 (3.295–3.6) | 885.223 (877.384–890.762) |
| baseline | file_merger | 3 | 0.5 (0.5–0.5) | 0.911 (0.911–0.911) | 0 | 0.684 (0.645–0.721) | 0.327 (0.259–0.363) | 3.623 (3.479–3.735) | 1119.223 (983.937–1238.45) |
| baseline | eve_jump_planner | 3 | 0.889 (0.667–1) | 0.944 (0.833–1) | 0.667 | 0.733 (0.684–0.761) | 0.334 (0.245–0.399) | 1.514 (1.283–1.675) | 559.866 (409.173–782.081) |
| baseline | execution_server | 3 | 0.778 (0.667–1) | 0.985 (0.978–1) | 0.333 | 0.674 (0.592–0.748) | 0.469 (0.415–0.531) | 1.829 (1.727–1.914) | 534.798 (454.366–675.018) |
| code-review | datagate | 3 | 0.714 (0.714–0.714) | 0.956 (0.956–0.956) | 0 | 0.398 (0.317–0.457) | 0.206 (0.188–0.219) | 6.76 (6.365–7.187) | 1738.313 (1654.203–1825.826) |
| code-review | textdrop | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.41 (0.283–0.605) | 0.192 (0.157–0.249) | 6.476 (5.609–7.231) | 1440.022 (1249.269–1573.589) |
| code-review | file_query_tool | 3 | 0.8 (0.8–0.8) | 0.975 (0.975–0.975) | 0 | 0.76 (0.747–0.782) | 0.284 (0.198–0.385) | 10.407 (9.309–11.306) | 2334.54 (2090.123–2484.433) |
| code-review | mvvault | 3 | 0.722 (0.5–0.833) | 0.946 (0.904–0.967) | 0 | 0.447 (0.379–0.519) | 0.381 (0.348–0.419) | 7.612 (6.918–8.269) | 1634.187 (1493.316–1733.088) |
| code-review | meshctl | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.517 (0.441–0.648) | 0.276 (0.243–0.3) | 9.638 (9.598–9.66) | 1946.033 (1921.123–1972.729) |
| code-review | eve_industry | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.432 (0.37–0.483) | 0.155 (0.108–0.186) | 7.062 (6.952–7.273) | 1709.281 (1666.42–1756.211) |
| code-review | layered_config_synthesizer | 3 | 0.083 (0–0.25) | 0.22 (0.087–0.411) | 0 | 0.457 (0.347–0.523) | 0.268 (0.254–0.294) | 5.423 (4.997–5.804) | 1176.617 (1041.686–1310.833) |
| code-review | eve_market_tools | 3 | 0.167 (0–0.25) | 0.585 (0.544–0.669) | 0 | 0.72 (0.681–0.742) | 0.335 (0.29–0.364) | 7.131 (6.42–8.18) | 1973.763 (1375.958–3052.696) |
| code-review | file_merger | 3 | 0.417 (0.25–0.5) | 0.907 (0.898–0.911) | 0 | 0.536 (0.405–0.623) | 0.246 (0.21–0.286) | 6.805 (6.478–7.098) | 1744.049 (1641.486–1906.359) |
| code-review | eve_jump_planner | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.575 (0.523–0.656) | 0.227 (0.168–0.272) | 3.202 (2.985–3.615) | 904.632 (778.464–1058.789) |
| code-review | execution_server | 3 | 0.778 (0.667–0.833) | 0.985 (0.978–0.988) | 0 | 0.435 (0.36–0.548) | 0.287 (0.266–0.318) | 5.236 (4.912–5.883) | 1235.851 (1081.825–1341.984) |
| verification | datagate | 3 | 0.667 (0.571–0.714) | 0.94 (0.909–0.956) | 0 | 0.65 (0.5–0.782) | 0.216 (0.168–0.268) | 3.569 (3.025–3.963) | 913.196 (755.401–1013.416) |
| verification | textdrop | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.554 (0.503–0.637) | 0.172 (0.149–0.186) | 3.792 (3.256–4.425) | 1027.068 (833.991–1185.66) |
| verification | file_query_tool | 3 | 0.867 (0.8–1) | 0.975 (0.95–1) | 0.333 | 0.796 (0.712–0.849) | 0.289 (0.219–0.358) | 6.499 (6.206–6.729) | 1664.141 (1637.114–1683.708) |
| verification | mvvault | 3 | 0.778 (0.667–0.833) | 0.962 (0.952–0.967) | 0 | 0.587 (0.51–0.636) | 0.479 (0.458–0.511) | 4.082 (3.862–4.313) | 973.383 (923.817–1019.93) |
| verification | meshctl | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.643 (0.591–0.683) | 0.333 (0.291–0.382) | 5.337 (5.118–5.46) | 1239.831 (1031.912–1389.301) |
| verification | eve_industry | 3 | 1 (1–1) | 1 (1–1) | 1 | 0.659 (0.632–0.7) | 0.286 (0.248–0.321) | 4.016 (3.829–4.12) | 1046.943 (938.941–1111.999) |
| verification | layered_config_synthesizer | 3 | 0 (0–0) | 0.114 (0–0.255) | 0 | 0.535 (0.492–0.582) | 0.243 (0.212–0.302) | 3.192 (3.05–3.332) | 813.446 (763.256–906.571) |
| verification | eve_market_tools | 3 | 0.25 (0.25–0.25) | 0.544 (0.544–0.544) | 0 | 0.762 (0.72–0.805) | 0.361 (0.315–0.425) | 4.668 (4.071–5.506) | 1623.007 (1065.96–2557.332) |
| verification | file_merger | 3 | 0.417 (0.25–0.5) | 0.907 (0.898–0.911) | 0 | 0.651 (0.64–0.668) | 0.278 (0.248–0.31) | 3.962 (3.767–4.133) | 1133.047 (1056.338–1173.144) |
| verification | eve_jump_planner | 3 | 0.778 (0.667–1) | 0.889 (0.833–1) | 0.333 | 0.729 (0.68–0.817) | 0.381 (0.291–0.434) | 1.928 (1.835–2.005) | 647.041 (570.044–719.444) |
| verification | execution_server | 3 | 0.778 (0.667–1) | 0.985 (0.978–1) | 0.333 | 0.668 (0.624–0.75) | 0.36 (0.351–0.371) | 2.959 (2.845–3.088) | 745.293 (720.049–777.208) |

### Per configuration: mean over problems [bootstrap 95%]

| configuration | solved | Core | reliable | erosion | verbosity | $ per problem |
|---|---|---|---|---|---|---|
| baseline | 0.697 [0.494, 0.876] | 0.855 [0.691, 0.977] | 0.394 [0.121, 0.667] | 0.707 [0.662, 0.752] | 0.358 [0.306, 0.417] | 3.196 [2.555, 3.882] |
| code-review | 0.698 [0.496, 0.873] | 0.87 [0.718, 0.981] | 0.364 [0.091, 0.636] | 0.517 [0.448, 0.596] | 0.26 [0.222, 0.302] | 6.887 [5.721, 8.05] |
| verification | 0.685 [0.485, 0.864] | 0.847 [0.679, 0.972] | 0.364 [0.121, 0.636] | 0.658 [0.608, 0.706] | 0.309 [0.26, 0.361] | 4 [3.338, 4.681] |

### Against the control: difference, paired by problem [bootstrap 95%]

| configuration | control | solved | Core | reliable | erosion | verbosity | $ per problem |
|---|---|---|---|---|---|---|---|
| code-review | baseline | 0.001 [-0.059, 0.059] | 0.016 [-0.007, 0.046] | -0.03 [-0.182, 0.091] | -0.19 [-0.246, -0.134] | -0.098 [-0.135, -0.059] | 3.69 [3.154, 4.246] |
| verification | baseline | -0.012 [-0.065, 0.036] | -0.008 [-0.034, 0.014] | -0.03 [-0.182, 0.091] | -0.05 [-0.097, -0.001] | -0.049 [-0.091, -0.008] | 0.804 [0.594, 1.039] |

Every run is complete.


## Breakage: tests passed at their own checkpoint and failing later

Per checkpoint after the first, the share of every earlier checkpoint's passed tests failing in its Regression group; the mean over checkpoints. Their harness's calibration runs list no tests and are left out.

| study | configuration | checkpoints | mean | checkpoints with any |
|---|---|---|---|---|
| baseline | baseline | 140 | 0.02% | 4 |
| survey | baseline | 94 | 0.16% | 8 |
| survey-rerun | baseline | 9 | 0.00% | 0 |
| baseline-added | baseline | 110 | 8.18% | 27 |
| review-verify | baseline | 129 | 0.19% | 12 |
| review-verify | code-review | 129 | 1.01% | 14 |
| review-verify | verification | 129 | 0.39% | 10 |
| review-verify-long | code-review | 7 | 40.16% | 4 |
| review-verify-long | verification | 7 | 38.97% | 4 |

Checkpoints breaking 5% or more:

| study | configuration | problem | repeat | checkpoint | broken / passed |
|---|---|---|---|---|---|
| survey | baseline | rejector | 1 | 4 | 3 / 48 (0.06) |
| baseline-added | baseline | test_translator | 1 | 5 | 72 / 607 (0.12) |
| baseline-added | baseline | test_translator | 1 | 6 | 74 / 781 (0.09) |
| baseline-added | baseline | test_translator | 1 | 7 | 74 / 917 (0.08) |
| baseline-added | baseline | test_translator | 1 | 8 | 74 / 1050 (0.07) |
| baseline-added | baseline | test_translator | 2 | 5 | 497 / 604 (0.82) |
| baseline-added | baseline | test_translator | 2 | 6 | 499 / 759 (0.66) |
| baseline-added | baseline | test_translator | 2 | 7 | 499 / 762 (0.65) |
| baseline-added | baseline | test_translator | 2 | 8 | 499 / 767 (0.65) |
| baseline-added | baseline | test_translator | 3 | 5 | 514 / 623 (0.83) |
| baseline-added | baseline | test_translator | 3 | 6 | 516 / 785 (0.66) |
| baseline-added | baseline | test_translator | 3 | 7 | 516 / 788 (0.65) |
| baseline-added | baseline | test_translator | 3 | 8 | 516 / 793 (0.65) |
| baseline-added | baseline | test_translator | 5 | 5 | 510 / 604 (0.84) |
| baseline-added | baseline | test_translator | 5 | 6 | 512 / 748 (0.68) |
| baseline-added | baseline | test_translator | 5 | 7 | 512 / 751 (0.68) |
| baseline-added | baseline | test_translator | 5 | 8 | 512 / 756 (0.68) |
| review-verify | code-review | layered_config_synthesizer | 1 | 2 | 3 / 14 (0.21) |
| review-verify | code-review | layered_config_synthesizer | 1 | 3 | 3 / 29 (0.10) |
| review-verify | code-review | layered_config_synthesizer | 1 | 4 | 3 / 41 (0.07) |
| review-verify | verification | layered_config_synthesizer | 2 | 2 | 3 / 14 (0.21) |
| review-verify | verification | layered_config_synthesizer | 2 | 3 | 3 / 26 (0.12) |
| review-verify | verification | layered_config_synthesizer | 2 | 4 | 3 / 38 (0.08) |
| review-verify | code-review | layered_config_synthesizer | 3 | 2 | 9 / 23 (0.39) |
| review-verify | code-review | layered_config_synthesizer | 3 | 3 | 10 / 40 (0.25) |
| review-verify | code-review | layered_config_synthesizer | 3 | 4 | 10 / 54 (0.19) |
| review-verify-long | code-review | test_translator | 1 | 5 | 500 / 609 (0.82) |
| review-verify-long | code-review | test_translator | 1 | 6 | 502 / 753 (0.67) |
| review-verify-long | code-review | test_translator | 1 | 7 | 502 / 756 (0.66) |
| review-verify-long | code-review | test_translator | 1 | 8 | 502 / 761 (0.66) |
| review-verify-long | verification | test_translator | 1 | 5 | 469 / 572 (0.82) |
| review-verify-long | verification | test_translator | 1 | 6 | 471 / 737 (0.64) |
| review-verify-long | verification | test_translator | 1 | 7 | 471 / 740 (0.64) |
| review-verify-long | verification | test_translator | 1 | 8 | 471 / 745 (0.63) |

## code-review: before and after its review, at the same checkpoint

177 checkpoints. Lines changed by the review: mean 112. Erosion lower after the review at 114, higher at 61.

| problem | checkpoints | erosion | cog_erosion | verbosity | total_loc | total_functions | high_cc_functions |
|---|---|---|---|---|---|---|---|
| datagate | 21 | 0.40 → 0.40 | 0.64 → 0.64 | 0.20 → 0.21 | 710.71 → 714.24 | 55.76 → 58.24 | 5.71 → 5.57 |
| eve_industry | 18 | 0.47 → 0.43 | 0.66 → 0.63 | 0.16 → 0.16 | 595.11 → 600.72 | 48.11 → 50.67 | 3.56 → 3.22 |
| eve_jump_planner | 9 | 0.57 → 0.58 | 0.75 → 0.74 | 0.24 → 0.23 | 362.67 → 365.22 | 30.44 → 31.11 | 3.22 → 3.22 |
| eve_market_tools | 12 | 0.73 → 0.72 | 0.87 → 0.86 | 0.34 → 0.34 | 1233.33 → 1237.67 | 79.67 → 82.92 | 13.08 → 13.08 |
| execution_server | 18 | 0.45 → 0.44 | 0.71 → 0.69 | 0.31 → 0.29 | 546.06 → 548.11 | 46.00 → 47.61 | 2.94 → 2.72 |
| file_merger | 12 | 0.56 → 0.54 | 0.79 → 0.77 | 0.24 → 0.25 | 979.42 → 986.25 | 75.00 → 77.58 | 9.58 → 9.17 |
| file_query_tool | 15 | 0.77 → 0.76 | 0.90 → 0.90 | 0.30 → 0.28 | 1867.93 → 1862.87 | 146.07 → 148.60 | 21.33 → 21.00 |
| layered_config_synthesizer | 12 | 0.52 → 0.46 | 0.68 → 0.66 | 0.28 → 0.27 | 628.83 → 624.50 | 49.75 → 51.33 | 5.25 → 4.25 |
| meshctl | 24 | 0.54 → 0.52 | 0.78 → 0.77 | 0.29 → 0.28 | 1019.46 → 1015.54 | 73.92 → 75.88 | 7.46 → 7.21 |
| mvvault | 18 | 0.49 → 0.45 | 0.73 → 0.70 | 0.40 → 0.38 | 882.61 → 876.67 | 74.56 → 77.00 | 7.33 → 6.67 |
| textdrop | 18 | 0.44 → 0.41 | 0.66 → 0.65 | 0.19 → 0.19 | 749.44 → 754.89 | 64.22 → 66.11 | 4.33 → 4.28 |
| all | 177 | 0.53 → 0.50 | 0.73 → 0.72 | 0.27 → 0.26 | 873.97 → 874.75 | 68.11 → 70.28 | 7.40 → 7.10 |

## The final code: each configuration's last checkpoint, mean over problems

| measure | baseline | code-review | verification | code-review lower on | verification lower on |
|---|---|---|---|---|---|
| erosion | 0.74 | 0.51 | 0.69 | 11 / 11 | 10 / 11 |
| cog_erosion | 0.89 | 0.72 | 0.86 | 11 / 11 | 9 / 11 |
| verbosity | 0.37 | 0.26 | 0.32 | 11 / 11 | 9 / 11 |
| total_loc | 1486.30 | 1370.55 | 1665.88 | 10 / 11 | 2 / 11 |
| total_functions | 84.79 | 110.79 | 117.79 | 0 / 11 | 0 / 11 |
| high_cc_functions | 16.33 | 11.64 | 16.42 | 10 / 11 | 5 / 11 |
