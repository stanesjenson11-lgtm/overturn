import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";

/**
 * Synthetic leases, generated rather than committed.
 *
 * Never ship a real person's lease in a public repo. These two are written to
 * stress the chunker differently: MAPLE_COURT uses numbered clauses (the easy,
 * common case) and GARDEN_FLAT is continuous prose with no numbering at all,
 * which is where clause-boundary chunking earns or loses its keep.
 *
 * ASCII only — pdf-lib's standard fonts are WinAnsi-encoded and throw on an
 * em dash or a smart quote.
 */

export const MAPLE_COURT = `MAPLE COURT RESIDENTIAL LEASE AGREEMENT

1. PARTIES AND PREMISES
This Lease is made between Maple Court Holdings LLC ("Landlord") and the undersigned tenant ("Tenant") for the residential unit at 14 Maple Court, Apartment 3B ("the Premises").

2. TERM
2.1 The initial term is twelve (12) months, beginning on the first day of the month following execution.
2.2 At the end of the initial term this Lease continues month to month unless either party gives notice under Section 12.

3. RENT
3.1 Monthly rent is $1,850, due on the first day of each month without demand.
3.2 Rent is considered late after the fifth day of the month. A late fee of $75 applies to any payment received after that date.
3.3 A payment returned for insufficient funds incurs an additional charge of $35 and is treated as though the payment was never made.

4. UTILITIES
4.1 Tenant is responsible for electricity, gas, internet, and telephone service.
4.2 Landlord pays for water, sewer, and trash collection.

5. SECURITY DEPOSIT
5.1 Tenant shall deposit $2,400 with Landlord upon execution of this Lease. The deposit does not bear interest and may not be applied to the final month's rent.
5.2 Landlord shall return the deposit, less any lawful deductions, within thirty (30) days after Tenant surrenders the Premises and provides a forwarding address.
5.3 Landlord may deduct unpaid rent, unpaid utility charges, the cost of repairing damage beyond normal wear and tear, and the cost of cleaning required to return the Premises to its condition at move-in.
5.4 Normal wear and tear means deterioration that occurs from the intended use of the Premises without negligence, and Landlord shall not deduct for it. Faded paint, worn carpet in walkways, and minor nail holes from hanging pictures are normal wear and tear. Burns, pet stains, large holes, and unapproved paint colors are not.

6. USE AND OCCUPANCY
6.1 The Premises shall be used solely as a private residence for the persons named on this Lease.
6.2 A guest may stay no more than fourteen (14) consecutive nights, or thirty (30) nights in any twelve month period, without Landlord's written consent.

7. QUIET ENJOYMENT
Tenant shall not disturb the peaceful enjoyment of other residents. Quiet hours are from 10:00 PM to 7:00 AM daily.

8. PETS
8.1 Tenant may keep up to two (2) cats or dogs, each weighing less than twenty-five (25) pounds at maturity, with Landlord's prior written consent.
8.2 An additional refundable pet deposit of $400 per animal is required before the animal may occupy the Premises.
8.3 Tenant is responsible for all damage caused by an animal, including damage in excess of the pet deposit.
8.4 Service animals and assistance animals are not pets under this Section and are not subject to the deposit or the weight limit.

9. ALTERATIONS
9.1 Tenant shall not paint, wallpaper, or make any structural alteration to the Premises without Landlord's prior written consent.
9.2 Tenant may hang pictures using nails or hooks that leave holes no larger than one quarter inch.

10. MAINTENANCE AND REPAIRS
10.1 Landlord shall maintain the structure, roof, plumbing, heating, and electrical systems in working order.
10.2 Tenant shall promptly report any condition requiring repair. Landlord shall respond to a report affecting habitability within twenty-four (24) hours and to all other reports within seven (7) days.
10.3 Tenant is responsible for replacing light bulbs, smoke detector batteries, and furnace filters.

11. ENTRY BY LANDLORD
11.1 Landlord may enter the Premises after giving Tenant at least twenty-four (24) hours written notice, and only between 9:00 AM and 6:00 PM.
11.2 Landlord may enter without notice in an emergency that threatens life or property.

12. TERMINATION AND NOTICE
12.1 Either party may terminate a month to month tenancy by giving sixty (60) days written notice.
12.2 Notice must be delivered in writing, either by hand or by certified mail to the address on page one.

13. EARLY TERMINATION
13.1 Tenant may terminate this Lease before the end of the initial term by giving sixty (60) days written notice and paying an early termination fee equal to two (2) months rent.
13.2 The security deposit may not be applied to the early termination fee.

14. SUBLETTING AND ASSIGNMENT
Tenant shall not sublet the Premises or assign this Lease without Landlord's prior written consent, which shall not be unreasonably withheld.

15. DEFAULT
15.1 Tenant is in default if rent remains unpaid ten (10) days after it is due, or if Tenant breaches any other term of this Lease and fails to cure within fourteen (14) days of written notice.

16. GOVERNING LAW
This Lease is governed by the laws of the state in which the Premises are located.`;

export const GARDEN_FLAT = `GARDEN FLAT TENANCY AGREEMENT

This agreement is entered into between the owner of the garden flat at 22 Wren Lane, referred to throughout as the owner, and the tenant whose signature appears at the end of this document. It is written in plain language on purpose, and both parties should read it in full before signing.

The tenancy begins on the date written on the signature page and runs for six months. After six months it continues on a rolling monthly basis until either party ends it. To end the tenancy, either party must give the other one full calendar month of notice in writing. Notice given part way through a month takes effect at the end of the following month, not the current one.

Rent is nine hundred and fifty pounds each month, paid by standing order on or before the first working day of the month. If rent has not arrived within seven days of the due date the owner may charge interest at three percent above the base rate, calculated daily from the date the payment was due. The owner would rather be told early about a difficulty than chase a missed payment, and will not charge interest where the tenant has agreed a plan in advance and kept to it.

A deposit of one thousand four hundred pounds is held in a government approved deposit protection scheme. The owner will tell the tenant which scheme within thirty days of receiving it. At the end of the tenancy the deposit is returned in full unless there is unpaid rent, damage that goes beyond fair wear and tear, or the flat has been left in a condition that requires more than an ordinary clean. Fair wear and tear covers the gradual ageing of carpets, paintwork and fittings through ordinary daily use. It does not cover burns, water damage from unattended baths, or holes left by shelving that was not agreed in advance.

The tenant may decorate the flat, but only after asking. In practice the owner says yes to most requests and no to dark colours on the walls of the small bedroom, which is difficult to cover again. Any change to the fabric of the building, including fixed shelving, replacement flooring, or anything that involves the electrical or plumbing systems, needs written permission first.

The owner is responsible for the structure of the building, the boiler, the plumbing, the electrical wiring, and any appliance that came with the flat. The tenant should report faults as soon as they appear. A fault that leaves the flat without heat, hot water, or a working toilet will be attended to within one working day. Anything else will be attended to within five working days, or sooner where the tenant is at home to allow access.

The owner may need to enter the flat occasionally, for inspections, repairs, or to show it to a prospective tenant near the end of the tenancy. Except in a genuine emergency such as a leak or a fire, the owner will give at least twenty-four hours notice and will suggest a time rather than simply arriving.

The garden at the rear of the property belongs to this flat alone and is the tenant's to use and to maintain. The owner will cut back the hedge along the rear boundary once a year in autumn. The tenant is asked to keep the garden from becoming overgrown, but nothing in this agreement requires a particular standard of gardening.

The flat may not be sublet, and it may not be listed on any short term letting platform. A friend or relative may stay for up to three weeks without asking. Longer than that, or anything that amounts to a second person living in the flat, needs to be agreed with the owner first.`;

const FIXTURES = {
  "maple-court": MAPLE_COURT,
  "garden-flat": GARDEN_FLAT,
} as const;

export type FixtureName = keyof typeof FIXTURES;

/** Renders text to a real PDF: line wrapping, page breaks, an actual text layer. */
export async function renderPdf(text: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const [size, leading, margin, width, height] = [11, 15.5, 56, 595, 842]; // A4 points

  let page = pdf.addPage([width, height]);
  let y = height - margin;

  const lineFor = (paragraph: string) => {
    const lines: string[] = [];
    let current = "";
    for (const word of paragraph.split(" ")) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width - margin * 2) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
    return lines;
  };

  for (const paragraph of text.split("\n")) {
    for (const line of paragraph ? lineFor(paragraph) : [""]) {
      if (y < margin) {
        page = pdf.addPage([width, height]);
        y = height - margin;
      }
      if (line) page.drawText(line, { x: margin, y, size, font });
      y -= leading;
    }
  }

  return pdf.save();
}

export async function writeFixtures(dir: string): Promise<Record<FixtureName, string>> {
  mkdirSync(dir, { recursive: true });
  const written = {} as Record<FixtureName, string>;

  for (const [name, text] of Object.entries(FIXTURES) as [FixtureName, string][]) {
    const file = path.join(dir, `${name}.pdf`);
    writeFileSync(file, await renderPdf(text));
    written[name] = file;
  }
  return written;
}

// `tsx scripts/fixtures.ts` writes them without seeding anything.
// pathToFileURL, not string concatenation: a Windows path is `C:\...`, whose
// file URL has three slashes, and the hand-built comparison silently never
// matches — the script exits 0 having done nothing.
if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  const written = await writeFixtures(path.join(process.cwd(), "eval/fixtures"));
  console.log(Object.values(written).join("\n"));
}
