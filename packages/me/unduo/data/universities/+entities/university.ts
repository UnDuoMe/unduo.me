/** Directory presence does not confirm Duo use. Enrollment URLs require a university source. */
export interface University {
  readonly id: string;
  readonly name: string;
  readonly country: string;
  readonly stateProvince?: string;
  readonly aliases: readonly string[];
  readonly portalUrl?: string;
  readonly note?: string;
  readonly sourceUrl: string;
  readonly sourceKind: "university" | "consortium" | "directory";
  readonly checkedAt?: string;
}
