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

  it("parses a realistic 20-clause Dutch lease (ROZ model)", () => {
    const dutchLease = `HUUROVEREENKOMST WOONRUIMTE
(model Raad voor Onroerende Zaken, versie 2017)

De ondergetekenden:
1. A.B. Jansen, wonende te Amsterdam, hierna te noemen: "verhuurder"
2. C.D. de Vries, wonende te Rotterdam, hierna te noemen: "huurder"

zijn het volgende overeengekomen:

Artikel 1 Het gehuurde, bestemming
1.1 Verhuurder verhuurt aan huurder en huurder huurt van verhuurder de woonruimte, hierna te noemen: "het gehuurde", plaatselijk bekend als Keizersgracht 100-H, 1015 AA Amsterdam.
1.2 Het gehuurde is uitsluitend bestemd om te worden gebruikt als woonruimte ten behoeve van huurder en de leden van zijn huishouden.

Artikel 2 Huurprijs, huurprijsaanpassing, betaalperiode
2.1 De huurprijs van het gehuurde bedraagt op de ingangsdatum € 1.500,00 per maand.
2.2 De huurprijs wordt jaarlijks per 1 juli aangepast overeenkomstig het bepaalde in artikel 18 van de algemene bepalingen.

Artikel 3 Servicekosten
3.1 Per maand is huurder aan verhuurder een voorschot op de servicekosten verschuldigd van € 150,00.
3.2 De servicekosten worden jaarlijks afgerekend.

Artikel 4 Borgsom
4.1 Huurder is verplicht bij aanvang van de huurovereenkomst een waarborgsom te betalen ter grootte van twee maanden kale huurprijs, derhalve € 3.000,00.

Artikel 5 Duur, verlenging, opzegging
5.1 Deze huurovereenkomst is aangegaan voor de duur van 12 maanden, ingaande op 1 februari 2025.
5.2 Na het verstrijken van de in 5.1 genoemde periode wordt deze huurovereenkomst voortgezet voor onbepaalde tijd.
5.3 Beëindiging van deze huurovereenkomst door opzegging kan slechts plaatsvinden tegen het einde van een maand.

Artikel 6 Leveringen en diensten
6.1 Verhuurder zal de volgende leveringen en diensten verzorgen: schoonmaak gemeenschappelijke ruimten.

Artikel 7 Bijzondere bepalingen
7.1 Huisdieren zijn niet toegestaan in het gehuurde.
7.2 Roken is niet toegestaan in het gehuurde.
7.3 Onderverhuur is niet toegestaan zonder schriftelijke toestemming van verhuurder.

Artikel 8 Onderhoud
8.1 Huurder is verplicht het gehuurde als een goed huurder te onderhouden.
8.2 Kleine herstellingen als bedoeld in het Besluit kleine herstellingen komen voor rekening van huurder.

Artikel 9 Aansprakelijkheid
9.1 Verhuurder is niet aansprakelijk voor schade als gevolg van gebreken die niet aan hem zijn toe te rekenen.

Artikel 10 Slotbepalingen
10.1 Op deze huurovereenkomst zijn de algemene bepalingen huurovereenkomst woonruimte van toepassing.
10.2 Huurder verklaart de algemene bepalingen te hebben ontvangen.

Aldus opgemaakt en getekend te Amsterdam.`;

    const result = parseClausesHeuristic(dutchLease, "residential_lease", "nl");

    // Should find 10 articles
    expect(result.length).toBe(10);

    // Verify first and last articles
    expect(result[0]?.text).toContain("Artikel 1");
    expect(result[0]?.text).toContain("gehuurde");
    expect(result[9]?.text).toContain("Artikel 10");
    expect(result[9]?.text).toContain("Slotbepalingen");

    // Verify sub-sections are within parent
    expect(result[0]?.text).toContain("1.1");
    expect(result[0]?.text).toContain("1.2");
    expect(result[4]?.text).toContain("5.1");
    expect(result[4]?.text).toContain("5.2");
    expect(result[4]?.text).toContain("5.3");

    // Preamble should be skipped
    const allText = result.map((c) => c.text).join(" ");
    expect(allText).not.toContain("De ondergetekenden");
    expect(allText).not.toContain("A.B. Jansen");

    // Signature block should be removed
    expect(allText).not.toContain("Aldus opgemaakt en getekend");

    // Sequential positions
    for (let i = 0; i < result.length; i++) {
      expect(result[i]?.position).toBe(i);
    }
  });

  it("handles French contract with Article headings", () => {
    const frenchContract = `Contrat de bail entre les parties soussignées.

Article 1 - Objet du bail
Le présent contrat a pour objet la location du logement situé au 42 Rue de Rivoli, Paris. Le logement est destiné à l'usage exclusif d'habitation principale du locataire.

Article 2 - Durée du bail
Le présent bail est consenti pour une durée de trois ans à compter du premier mars deux mille vingt-cinq.

Article 3 - Loyer et charges
Le loyer mensuel est fixé à mille deux cents euros, payable le premier jour de chaque mois.

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
Der Vermieter vermietet dem Mieter die Wohnung in der Hauptstraße 15, Berlin. Die Wohnung ist ausschließlich zu Wohnzwecken bestimmt.

Paragraph 2 Mietdauer
Das Mietverhältnis beginnt am ersten März zweitausendundzwanzig und läuft auf unbestimmte Zeit.

Paragraph 3 Mietzins
Die monatliche Miete beträgt achthundert Euro, zahlbar jeweils zum ersten eines Monats.`;

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
The lease runs for 12 months from February 1, 2025. After the initial term, it continues month-to-month.

3. Rent
Monthly rent is $1,500 due on the first of each month. Late payment incurs a 5% penalty after a 5-day grace period.

4. Security Deposit
Tenant shall pay a security deposit of $3,000. The deposit will be returned within 30 days of lease termination, minus any deductions for damages.

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
This agreement shall be governed by the laws of the State of California. Any disputes shall be resolved through binding arbitration.

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
