# baseline-added

- baseline-added: baseline 2b3921ca80cd

## Per problem: mean (min–max) over complete runs

| configuration | problem | runs | solved | Core | reliable | erosion | verbosity | $ | seconds |
|---|---|---|---|---|---|---|---|---|---|
| baseline | layered_config_synthesizer | 5 | 0 (0–0) | 0.217 (0.161–0.255) | 0 | 0.65 (0.573–0.738) | 0.34 (0.319–0.363) | 2.258 (2.139–2.345) | 576.789 (518.147–665.713) |
| baseline | test_translator | 5 | 0.35 (0.25–0.375) | 0.57 (0.425–0.86) | 0 | 0.825 (0.798–0.854) | 0.471 (0.411–0.517) | 15.26 (11.849–18.126) | 3956.326 (3191.01–4663.604) |
| baseline | eve_market_tools | 5 | 0.25 (0.25–0.25) | 0.569 (0.544–0.669) | 0 | 0.851 (0.803–0.952) | 0.478 (0.305–0.882) | 3.306 (3.077–3.703) | 857.468 (762.297–1062.335) |
| baseline | file_merger | 5 | 0.5 (0.5–0.5) | 0.911 (0.911–0.911) | 0 | 0.721 (0.643–0.769) | 0.322 (0.231–0.404) | 3.474 (3.229–3.757) | 1103.274 (970.595–1217.073) |
| baseline | eve_jump_planner | 5 | 0.867 (0.667–1) | 0.933 (0.833–1) | 0.6 | 0.729 (0.611–0.836) | 0.18 (0.084–0.342) | 1.366 (1.271–1.505) | 421.303 (405.89–452.364) |
| baseline | execution_server | 5 | 0.8 (0.667–0.833) | 0.986 (0.978–0.988) | 0 | 0.663 (0.505–0.744) | 0.472 (0.441–0.51) | 1.778 (1.653–1.97) | 440.733 (397.171–482.702) |

## Per configuration: mean over problems [bootstrap 95%]

| configuration | solved | Core | reliable | erosion | verbosity | $ per problem |
|---|---|---|---|---|---|---|
| baseline | 0.461 [0.208, 0.703] | 0.698 [0.464, 0.903] | 0.1 [0, 0.333] | 0.74 [0.675, 0.805] | 0.377 [0.283, 0.469] | 4.574 [1.94, 8.931] |

## Against the control: difference, paired by problem [bootstrap 95%]

No configuration to compare.

Every run is complete.
