/** Directory presence does not confirm Duo use. Enrollment URLs require a university source. */
export interface University {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly stateProvince?: string;
  readonly aliases: readonly string[];
  readonly portalUrl?: string;
  /**
   * The design of Duo's pages at `portalUrl`: `universal` for the Universal
   * Prompt and its device management portal. Without it, the setup file
   * describes the Traditional Prompt's My Settings & Devices.
   */
  readonly duoPrompt?: "universal";
  readonly note?: string;
  readonly sourceUrl: string;
  readonly sourceKind: "university" | "consortium" | "directory";
  readonly checkedAt?: string;
}
