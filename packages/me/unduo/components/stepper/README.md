# @-/me.unduo.components.stepper

The numbered row of steps above a page's step card. The home page and the setup file each have their own. `stepper({ id, label, steps, select })` builds it from a state holding `StepperStep`s and calls `select` with a step's `index` when a reachable step other than the open one is clicked. It reads the number of steps once, so that must not change. Its styles are the `.step-*` classes in the setup stylesheet.
