import { describe, expect, it } from "vitest";
import { parseClausesHeuristic } from "../heuristic-parse";

// ── Dutch lease with numbered sections (primary use case) ────────

const DUTCH_LEASE = `HUUROVEREENKOMST WOONRUIMTE

De ondergetekenden:
Verhuurder: Jan Jansen, wonende te Amsterdam
Huurder: Piet Pieter, wonende te Rotterdam
Zijn het volgende overeengekomen:

1. Het gehuurde, bestemming
1.1 Verhuurder verhuurt aan huurder de woonruimte gelegen aan de Keizersgracht 100 te Amsterdam.
1.2 Het gehuurde is uitsluitend bestemd om te worden gebruikt als woonruimte.

2. Huurprijs, huurprijsaanpassing
2.1 De huurprijs van het gehuurde bedraagt € 1.500,- per maand.
2.2 De huurprijs wordt jaarlijks per 1 juli aangepast conform de consumentenprijsindex.

3. Betalingsverplichting, betaalperiode
3.1 Per maand is huurder verschuldigd de huurprijs vermeerderd met de vergoeding voor bijkomende leveringen en diensten.
3.2 De betaling dient te geschieden voor de eerste dag van de maand.

4. Borgsom
4.1 Huurder zal bij aanvang van de huurovereenkomst een borgsom betalen ter grootte van twee maanden huur.
4.2 De borgsom wordt terugbetaald na beëindiging van de huur, verminderd met eventuele kosten.

5. Onderhoud
5.1 Huurder dient het gehuurde in goede staat te onderhouden.
5.2 Kleine herstellingen komen voor rekening van huurder.

In witness whereof the parties have signed this agreement.`;

describe("parseClausesHeuristic", () => {
  describe("Dutch lease with dotted decimal headings", () => {
    it("splits on top-level numbered sections", () => {
      const result = parseClausesHeuristic(DUTCH_LEASE, "residential_lease", "nl");
      // Should split on 1., 2., 3., 4., 5. — preamble skipped, signature removed
      expect(result.length).toBeGreaterThanOrEqual(4);
      expect(result.length).toBeLessThanOrEqual(6);
    });

    it("preserves heading numbers in clause text", () => {
      const result = parseClausesHeuristic(DUTCH_LEASE, "residential_lease", "nl");
      expect(result[0]?.text).toMatch(/^1\.\s/);
    });

    it("includes sub-sections within parent clause", () => {
      const result = parseClausesHeuristic(DUTCH_LEASE, "residential_lease", "nl");
      expect(result[0]?.text).toContain("1.1");
      expect(result[0]?.text).toContain("1.2");
    });

    it("skips pre-heading content (preamble)", () => {
      const result = parseClausesHeuristic(DUTCH_LEASE, "residential_lease", "nl");
      const allText = result.map((c) => c.text).join(" ");
      expect(allText).not.toContain("De ondergetekenden");
      expect(allText).not.toContain("HUUROVEREENKOMST");
    });

    it("removes signature blocks", () => {
      const result = parseClausesHeuristic(DUTCH_LEASE, "residential_lease", "nl");
      const allText = result.map((c) => c.text).join(" ");
      expect(allText).not.toContain("In witness whereof");
    });

    it("returns zero-based sequential positions", () => {
      const result = parseClausesHeuristic(DUTCH_LEASE, "residential_lease", "nl");
      for (let i = 0; i < result.length; i++) {
        expect(result[i]?.position).toBe(i);
      }
    });

    it("returns correct ParsedClause shape", () => {
      const result = parseClausesHeuristic(DUTCH_LEASE, "residential_lease", "nl");
      for (const clause of result) {
        expect(clause).toHaveProperty("text");
        expect(clause).toHaveProperty("position");
        expect(typeof clause.text).toBe("string");
        expect(typeof clause.position).toBe("number");
        expect(clause.text.length).toBeGreaterThan(0);
        expect(clause.position).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ── English contract with Article headings ────────────────────

  const ENGLISH_ARTICLE_CONTRACT = `Agreement between Company A and Company B.

Article 1 - Definitions
In this agreement, the following terms shall have the meanings set out below.
"Services" means the consulting services described in Schedule 1.

Article 2 - Scope of Services
The Contractor shall provide the Services in accordance with the terms of this Agreement.
The Services shall commence on the Effective Date and continue for the Term.

Article 3 - Payment
The Client shall pay the Contractor the Fee as set out in Schedule 2.
Payment shall be made within 30 days of receipt of a valid invoice.

Article 4 - Confidentiality
Each party shall keep confidential all information received from the other party.
This obligation shall survive termination of this Agreement.

Article 5 - Termination
Either party may terminate this Agreement by giving 30 days written notice.
The Client may terminate immediately if the Contractor commits a material breach.`;

  describe("English contract with Article headings", () => {
    it("detects article keyword pattern", () => {
      const result = parseClausesHeuristic(ENGLISH_ARTICLE_CONTRACT, "consulting", "en");
      expect(result.length).toBe(5);
    });

    it("preserves Article heading in clause text", () => {
      const result = parseClausesHeuristic(ENGLISH_ARTICLE_CONTRACT, "consulting", "en");
      expect(result[0]?.text).toContain("Article 1");
      expect(result[2]?.text).toContain("Article 3");
    });
  });

  // ── ALL-CAPS headings ────────────────────────────────────────

  const ALLCAPS_CONTRACT = `RENT
The monthly rent shall be $2,000 payable on the first day of each month.
Late payment shall incur a penalty of 5% of the outstanding amount.

DEPOSIT
The tenant shall provide a security deposit equal to two months rent.
The deposit shall be returned within 30 days of lease termination.

MAINTENANCE
The tenant shall maintain the premises in good condition.
Normal wear and tear is acceptable.

TERMINATION
Either party may terminate with 60 days written notice.
Early termination requires payment of a penalty fee.

INSURANCE
The tenant shall maintain renter's insurance throughout the lease term.
Minimum coverage shall be $100,000.`;

  describe("ALL-CAPS headings", () => {
    it("detects ALL-CAPS pattern and splits correctly", () => {
      const result = parseClausesHeuristic(ALLCAPS_CONTRACT, "lease", "en");
      expect(result.length).toBe(5);
    });

    it("preserves heading in clause text", () => {
      const result = parseClausesHeuristic(ALLCAPS_CONTRACT, "lease", "en");
      expect(result[0]?.text).toMatch(/^RENT/);
      expect(result[3]?.text).toMatch(/^TERMINATION/);
    });
  });

  // ── No clear headings → paragraph fallback ───────────────────

  describe("paragraph fallback", () => {
    it("falls back to paragraph splitting when no headings detected", () => {
      const noHeadings = `This is the first paragraph of the contract. It contains some terms and conditions that both parties have agreed to follow.

This is the second paragraph. It describes the payment terms and schedule that shall be followed throughout the agreement.

This is the third paragraph. It covers the termination conditions and the process for ending the agreement early.

This is the fourth paragraph. It describes the confidentiality obligations of both parties to the agreement.`;

      const result = parseClausesHeuristic(noHeadings, "general", "en");
      expect(result.length).toBe(4);
    });

    it("treats document as single clause when too few paragraphs", () => {
      const shortDoc = `This is a very short document with only one paragraph. It barely has any content at all.`;

      const result = parseClausesHeuristic(shortDoc, "general", "en");
      expect(result.length).toBe(1);
      expect(result[0]?.position).toBe(0);
    });

    it("treats document as single clause when too many paragraphs", () => {
      // Generate 70 short paragraphs (avoid "paragraph" keyword — it's an article keyword)
      const manyParagraphs = Array.from(
        { length: 70 },
        (_, i) => `Item ${i + 1} with some content that is meaningful enough to be a real block.`,
      ).join("\n\n");

      const result = parseClausesHeuristic(manyParagraphs, "general", "en");
      expect(result.length).toBe(1);
    });
  });

  // ── Fragment merging ─────────────────────────────────────────

  describe("fragment merging", () => {
    it("merges fragments shorter than 50 characters into previous clause", () => {
      const withShortSection = `Article 1 - Definitions
Terms used in this agreement shall have the meanings set forth in this section.
All definitions apply throughout the entire agreement document.

Article 2 - x

Article 3 - Payment Terms
The client shall pay all invoices within 30 calendar days of the invoice date.
Late payments shall accrue interest at the rate of 1.5% per month.`;

      const result = parseClausesHeuristic(withShortSection, "general", "en");
      // Article 2 body is too short, should merge with Article 1
      // Check that no clause has fewer than 50 chars
      for (const clause of result) {
        expect(clause.text.length).toBeGreaterThanOrEqual(50);
      }
    });
  });

  // ── Roman numerals ───────────────────────────────────────────

  describe("roman numeral headings", () => {
    it("detects roman numeral pattern", () => {
      const romanContract = `I. Introduction
This agreement is entered into by the undersigned parties for the purpose of establishing a professional services relationship.

II. Services
The consultant shall provide advisory services as described in the attached schedule of work.

III. Compensation
The client shall compensate the consultant at the agreed hourly rate of one hundred dollars per hour.

IV. Term
This agreement shall be effective for a period of twelve months from the date of signing.`;

      const result = parseClausesHeuristic(romanContract, "consulting", "en");
      expect(result.length).toBe(4);
      expect(result[0]?.text).toContain("I.");
    });
  });

  // ── Performance ──────────────────────────────────────────────

  describe("performance", () => {
    it("completes in under 10ms for a 25KB document", () => {
      // Generate a ~25KB document with numbered sections
      const sections: string[] = [];
      const filler =
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";
      for (let i = 1; i <= 30; i++) {
        const body = `${i}. Section ${i}\n${i}.1 This is subsection ${i}.1 with enough text to make the clause substantial. The parties agree to the terms set forth herein. ${filler}\n${i}.2 This is subsection ${i}.2 with more detailed provisions about the subject matter. ${filler}\n\n`;
        sections.push(body);
      }
      const largeDoc = sections.join("");
      expect(largeDoc.length).toBeGreaterThan(20000);

      const start = performance.now();
      const result = parseClausesHeuristic(largeDoc, "lease", "en");
      const elapsed = performance.now() - start;

      expect(elapsed).toBeLessThan(10);
      expect(result.length).toBe(30);
    });
  });

  // ── Parenthetical headings ───────────────────────────────────

  describe("parenthetical headings", () => {
    it("detects parenthetical pattern", () => {
      const parenContract = `(a) The tenant shall pay rent of $1,000 per month on the first day of each month without deduction or offset. Late payment incurs a 5% penalty.

(b) The landlord shall maintain the structural integrity of the building and common areas. Major repairs are the landlord's responsibility.

(c) Either party may terminate this lease by providing sixty days written notice to the other party. Early termination requires penalty payment.`;

      const result = parseClausesHeuristic(parenContract, "lease", "en");
      expect(result.length).toBe(3);
    });
  });
});
