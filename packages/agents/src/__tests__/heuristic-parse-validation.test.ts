import { describe, expect, it } from "vitest";
import { parseClausesHeuristic } from "../heuristic-parse";
import { SAMPLE_CONTRACT_TEXT } from "./fixtures/generate-pdf";

describe("heuristic parser validation against real documents", () => {
  it("parses the sample contract fixture correctly", () => {
    const result = parseClausesHeuristic(SAMPLE_CONTRACT_TEXT, "residential_lease", "en");

    // Should find 5 numbered sections (1-5)
    expect(result.length).toBe(5);

    // Verify clause boundaries
    expect(result[0]?.text).toContain("PREMISES");
    expect(result[1]?.text).toContain("TERM");
    expect(result[2]?.text).toContain("RENT");
    expect(result[3]?.text).toContain("SECURITY DEPOSIT");
    expect(result[4]?.text).toContain("TERMINATION");

    // Preamble should be skipped (contains "entered into" + party names)
    const allText = result.map((c) => c.text).join(" ");
    expect(allText).not.toContain("John Smith (hereinafter");
  });

  it("parses a realistic 10-article lease with Article headings", () => {
    const articleLease = `RESIDENTIAL LEASE AGREEMENT
(Standard Form, revised 2023)

The undersigned:
1. R. Thompson, residing at 45 Maple Drive, hereinafter referred to as "Landlord"
2. S. Patel, residing at 12 Oak Lane, hereinafter referred to as "Tenant"

have agreed as follows:

Article 1 Premises, intended use
1.1 Landlord leases to Tenant the residential unit, hereinafter referred to as "the premises", located at 88 Birch Court, Unit 4-A, Springfield 60001.
1.2 The premises shall be used exclusively as a private residence for the Tenant and members of the Tenant's household.

Article 2 Rent, rent adjustment, payment period
2.1 The monthly rent for the premises shall be $1,800.00 as of the commencement date.
2.2 The rent shall be adjusted annually on July 1 in accordance with the consumer price index as set forth in Section 18 of the general terms.

Article 3 Service charges
3.1 Each month the Tenant shall pay to the Landlord an advance on service charges of $125.00.
3.2 Service charges shall be settled annually.

Article 4 Security deposit
4.1 Tenant shall pay a security deposit equal to two months base rent, being $3,600.00, at the commencement of this lease.

Article 5 Duration, renewal, termination
5.1 This lease is entered into for a period of 12 months, commencing on April 1, 2024.
5.2 After the expiry of the period referred to in 5.1, this lease shall continue on a month-to-month basis.
5.3 Termination of this lease by notice may only take effect at the end of a calendar month.

Article 6 Services and utilities
6.1 Landlord shall provide the following services: cleaning of common areas and hallways.

Article 7 Special provisions
7.1 Pets are not permitted on the premises without prior written consent.
7.2 Smoking is not permitted on the premises.
7.3 Subletting is not permitted without written consent of the Landlord.

Article 8 Maintenance
8.1 Tenant shall maintain the premises as a responsible tenant.
8.2 Minor repairs as defined in the maintenance schedule shall be at the expense of the Tenant.

Article 9 Liability
9.1 Landlord shall not be liable for damage resulting from defects not attributable to the Landlord.

Article 10 Final provisions
10.1 The general terms and conditions for residential leases shall apply to this agreement.
10.2 Tenant acknowledges receipt of the general terms and conditions.

Signed by the parties at Springfield.`;

    const result = parseClausesHeuristic(articleLease, "residential_lease", "en");

    // Should find 10 articles
    expect(result.length).toBe(10);

    // Verify first and last articles
    expect(result[0]?.text).toContain("Article 1");
    expect(result[0]?.text).toContain("Premises");
    expect(result[9]?.text).toContain("Article 10");
    expect(result[9]?.text).toContain("Final provisions");

    // Verify sub-sections are within parent
    expect(result[0]?.text).toContain("1.1");
    expect(result[0]?.text).toContain("1.2");
    expect(result[4]?.text).toContain("5.1");
    expect(result[4]?.text).toContain("5.2");
    expect(result[4]?.text).toContain("5.3");

    // Preamble should be skipped
    const allText = result.map((c) => c.text).join(" ");
    expect(allText).not.toContain("The undersigned");
    expect(allText).not.toContain("R. Thompson");

    // Signature block should be removed
    expect(allText).not.toContain("Signed by the parties");

    // Sequential positions
    for (let i = 0; i < result.length; i++) {
      expect(result[i]?.position).toBe(i);
    }
  });

  it("handles French contract with Article headings", () => {
    const frenchContract = `Contrat de bail entre les parties soussignées.

Article 1 - Objet du bail
Le présent contrat a pour objet la location du logement situé au 8 Boulevard Haussmann, Lyon. Le logement est destiné à l'usage exclusif d'habitation principale du locataire.

Article 2 - Durée du bail
Le présent bail est consenti pour une durée de trois ans à compter du premier juin deux mille vingt-quatre.

Article 3 - Loyer et charges
Le loyer mensuel est fixé à neuf cents euros, payable le premier jour de chaque mois.

Article 4 - Dépôt de garantie
Un dépôt de garantie équivalent à un mois de loyer est exigé à la signature du bail.`;

    const result = parseClausesHeuristic(frenchContract, "residential_lease", "fr");

    expect(result.length).toBe(4);
    expect(result[0]?.text).toContain("Article 1");
    expect(result[3]?.text).toContain("Article 4");
  });

  it("handles German contract with Paragraph headings", () => {
    const germanContract = `Mietvertrag zwischen den nachstehend genannten Parteien.

Paragraph 1 Mietobjekt
Der Vermieter vermietet dem Mieter die Wohnung in der Schillerstraße 22, München. Die Wohnung ist ausschließlich zu Wohnzwecken bestimmt.

Paragraph 2 Mietdauer
Das Mietverhältnis beginnt am ersten Januar zweitausendeinundzwanzig und läuft auf unbestimmte Zeit.

Paragraph 3 Mietzins
Die monatliche Miete beträgt sechshundert Euro, zahlbar jeweils zum ersten eines Monats.`;

    const result = parseClausesHeuristic(germanContract, "residential_lease", "de");

    // 3 paragraphs — pre-heading preamble is skipped
    expect(result.length).toBe(3);
    expect(result[0]?.text).toContain("Paragraph 1");
    // Preamble skipped
    const allText = result.map((c) => c.text).join(" ");
    expect(allText).not.toContain("Mietvertrag zwischen");
  });

  it("comparison: clause count is reasonable for a standard contract", () => {
    // A standard residential lease typically has 10-25 clauses
    // The heuristic parser should produce a count in this range
    const standardLease = `Agreement between Landlord and Tenant.

1. Premises
The landlord leases the property at 123 Main St to the tenant. The property includes all fixtures and fittings currently installed.

2. Term
The lease runs for 12 months from April 1, 2024. After the initial term, it continues month-to-month.

3. Rent
Monthly rent is $1,800 due on the first of each month. Late payment incurs a 5% penalty after a 5-day grace period.

4. Security Deposit
Tenant shall pay a security deposit of $3,600. The deposit will be returned within 30 days of lease termination, minus any deductions for damages.

5. Utilities
Tenant is responsible for all utilities including electricity, gas, water, and internet. Landlord pays for building maintenance.

6. Maintenance
Tenant shall maintain the premises in good condition. Landlord is responsible for structural repairs and major systems.

7. Modifications
No modifications or alterations without written consent of the landlord. Any approved modifications become property of the landlord.

8. Insurance
Tenant shall maintain renter's insurance with minimum coverage of $100,000. Proof of insurance must be provided annually.

9. Pets
No pets without written consent. If approved, an additional pet deposit of $500 is required.

10. Termination
Either party may terminate with 60 days written notice. Early termination by tenant requires payment of two months rent as penalty.

11. Governing Law
This agreement shall be governed by the laws of the State of New York. Any disputes shall be resolved through binding arbitration.

12. Entire Agreement
This document constitutes the entire agreement between the parties. No oral agreements or representations are binding.`;

    const result = parseClausesHeuristic(standardLease, "residential_lease", "en");

    // Should produce exactly 12 clauses
    expect(result.length).toBe(12);

    // Each clause should have reasonable length (not just a heading)
    for (const clause of result) {
      expect(clause.text.length).toBeGreaterThan(50);
    }
  });
});
