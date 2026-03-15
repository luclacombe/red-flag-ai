/**
 * Generates a minimal valid PDF with the given text content.
 * Uses raw PDF syntax — no dependencies needed.
 */
export function generateMinimalPdf(text: string): Uint8Array {
  // Escape special PDF characters in text
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

  const pdf = `%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj

4 0 obj
<< /Length ${escaped.length + 25} >>
stream
BT /F1 12 Tf 72 720 Td (${escaped}) Tj ET
endstream
endobj

5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

xref
0 6
0000000000 65535 f
0000000009 00000 n
0000000058 00000 n
0000000115 00000 n
0000000266 00000 n
trailer
<< /Size 6 /Root 1 0 R >>
startxref
0
%%EOF`;

  return new TextEncoder().encode(pdf);
}

/** A sample contract text for testing */
export const SAMPLE_CONTRACT_TEXT = `RESIDENTIAL LEASE AGREEMENT

This Lease Agreement is entered into as of March 1, 2024, by and between
John Smith (hereinafter referred to as "Landlord") and Jane Doe (hereinafter
referred to as "Tenant").

1. PREMISES. Landlord hereby leases to Tenant the property located at
456 Oak Avenue, Springfield, State 60001.

2. TERM. The lease term shall begin on April 1, 2024 and end on
March 31, 2025.

3. RENT. Tenant shall pay monthly rent of $1,800.00, due on the first
day of each month.

4. SECURITY DEPOSIT. Tenant shall pay a security deposit of $3,600.00.

5. TERMINATION. Either party may terminate this lease with 30 days
written notice.`;

/** A sample non-contract text for testing */
export const SAMPLE_ARTICLE_TEXT = `How to Make the Perfect Chocolate Cake

Baking a chocolate cake from scratch is easier than you think.
Here are the ingredients you'll need:

- 2 cups all-purpose flour
- 2 cups sugar
- 3/4 cup cocoa powder
- 2 eggs
- 1 cup milk

Preheat your oven to 350 degrees Fahrenheit. Mix all dry ingredients
together, then add wet ingredients. Pour into a greased pan and bake
for 30-35 minutes.`;
