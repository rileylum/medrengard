# survey-rerun

- survey-rerun: baseline 2b3921ca80cd

## Per problem: mean (min–max) over complete runs

| configuration | problem | runs | solved | Core | reliable | erosion | verbosity | $ | seconds |
|---|---|---|---|---|---|---|---|---|---|
| baseline | dynamic_buffer | 1 | 0.25 (0.25–0.25) | 0.544 (0.544–0.544) | 0 | 0.86 (0.86–0.86) | 0.283 (0.283–0.283) | – (–––) | 5333.069 (5333.069–5333.069) |
| baseline | mocked_http | 1 | 0.75 (0.75–0.75) | 0.859 (0.859–0.859) | 0 | 0.715 (0.715–0.715) | 0.33 (0.33–0.33) | 9.727 (9.727–9.727) | 3092.066 (3092.066–3092.066) |

## Per configuration: mean over problems [bootstrap 95%]

| configuration | solved | Core | reliable | erosion | verbosity | $ per problem |
|---|---|---|---|---|---|---|
| baseline | 0.5 [0.25, 0.75] | 0.702 [0.544, 0.859] | 0 [0, 0] | 0.787 [0.715, 0.86] | 0.306 [0.283, 0.33] | 9.727 [9.727, 9.727] |

## Against the control: difference, paired by problem [bootstrap 95%]

No configuration to compare.

Every run is complete.
