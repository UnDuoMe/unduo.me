/** One step as a stepper shows it. */
export interface StepperStep {
  /** What the stepper passes to `select` when this step is chosen. */
  index: number;
  /** The number shown. */
  number: number;
  label: string;
  state: "active" | "complete" | "upcoming";
  /** Whether the line from this step to the next shows as done. */
  finished: boolean;
  reachable: boolean;
  /** What a screen reader hears after the label. */
  description: string;
}
