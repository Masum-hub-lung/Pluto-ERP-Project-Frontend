import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * PEP-502 Terms of service and Privacy policy (public pages /terms and /privacy). A DRAFT for the owner's lawyer:
 * change the facts in LEGAL and the wording below once reviewed, then raise `pluto.terms_version` on the server
 * (and VERSION here) so people accept the new text. Plain language on purpose: customers are trading firms, not lawyers.
 */
export const LEGAL = {
  version: '2026-11-15',
  updated: '15 November 2026',
  operator: 'Pluto Software Ltd.', // the business that sells Pluto: confirm the registered name
  country: 'Bangladesh',
  contact: 'the support e-mail or WhatsApp number we give you when you sign up', // replace with the real address
} as const

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ minHeight: '100vh', background: 'var(--paper)', color: 'var(--ink)', padding: '40px 16px' }}>
      <article style={{ maxWidth: 760, margin: '0 auto', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', padding: '32px clamp(16px, 4vw, 40px)', lineHeight: 1.6 }}>
        <p style={{ margin: 0, font: '650 11.5px/16px var(--font-sans)', letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--brand-ink)' }}>Pluto</p>
        <h1 style={{ margin: '6px 0 4px', font: '500 32px/40px var(--font-serif)' }}>{title}</h1>
        <p style={{ margin: '0 0 8px', color: 'var(--ink-muted)', fontSize: 14 }}>Version {LEGAL.version} · last updated {LEGAL.updated}</p>
        <p role="note" style={{ margin: '0 0 24px', padding: '10px 12px', borderRadius: 'var(--radius-md)', background: 'var(--warning-soft, var(--accent-soft))', fontSize: 14 }}>
          Draft: this text is being reviewed by a lawyer and may change. If it changes, we will ask you to agree to the new version.
        </p>
        {children}
        <hr style={{ border: 0, borderTop: '1px solid var(--line)', margin: '32px 0 16px' }} />
        <nav style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14 }}>
          <Link to="/terms">Terms of service</Link><Link to="/privacy">Privacy policy</Link><Link to="/sign-in">Sign in to Pluto</Link>
        </nav>
      </article>
    </main>
  )
}

const H = ({ children }: { children: ReactNode }) => <h2 style={{ margin: '28px 0 8px', font: '600 18px/26px var(--font-sans)' }}>{children}</h2>

export function Terms() {
  return (
    <Page title="Terms of service">
      <p>These terms are an agreement between your business (“you”) and {LEGAL.operator} (“we”), which provides Pluto, online accounting and business software. By creating an account or using Pluto you agree to them.</p>
      <H>1. The service</H>
      <p>Pluto lets your business keep its books, sales, purchases, stock, letters of credit, cash and bank records and reports online. What your company can use depends on the plan you buy (number of users, branches and modules such as LC management).</p>
      <H>2. Your account</H>
      <ul>
        <li>Keep your password and 2-step verification codes private. You are responsible for what is done with your account.</li>
        <li>Your company’s Owner decides who joins and with which role, and can remove people at any time.</li>
        <li>Give correct information and tell us if you think someone else is using your account.</li>
      </ul>
      <H>3. Your data belongs to you</H>
      <ul>
        <li>Everything you enter (customers, suppliers, items, invoices, vouchers, LCs, attachments) is your business’s data. We do not sell it or use it for advertising.</li>
        <li>An Owner can download all of it at any time (Settings › Backup and export › Export all my data).</li>
        <li>Each company’s data is kept apart: other companies using Pluto cannot see it.</li>
      </ul>
      <H>4. Our access for support</H>
      <p>To help you, our support staff may open your company, either read-only or as “Pluto support” with Owner rights. Every visit is recorded in your company’s activity log under their name, your Owners are notified, and you can remove Pluto support from your users at any time.</p>
      <H>5. Fees and payment</H>
      <ul>
        <li>You pay the price agreed for your plan, monthly or for the period you choose, in advance.</li>
        <li>We remind your Owners before the due date. If a payment is late by more than the agreed grace days, the company is paused: nobody can open it, but <strong>nothing is deleted</strong>, and it reopens as soon as payment is recorded.</li>
        <li>Prices may change with 30 days’ notice; the new price applies from your next payment.</li>
      </ul>
      <H>6. Fair use</H>
      <p>Do not use Pluto for anything illegal, to try to reach other companies’ data, to overload or attack the service, or to copy or resell it.</p>
      <H>7. Availability and backups</H>
      <p>We work to keep Pluto available and take a backup every day, but we cannot promise it will never be interrupted (for example during updates, which we announce in advance where we can). Please keep your own copies of important documents too.</p>
      <H>8. Your accounting and tax</H>
      <p>Pluto calculates and records what you enter, following the accounting rules it is built on. Your business and its accountant remain responsible for your books, VAT, tax returns and other legal filings.</p>
      <H>9. Liability</H>
      <p>As far as the law allows, we are not liable for indirect losses (such as lost profit) and our total liability for any claim is limited to the fees you paid us in the 12 months before it.</p>
      <H>10. Ending the service</H>
      <p>You can stop using Pluto at any time; download your data first. We may end the service for a company that breaks these terms or stays unpaid, after giving notice. After a company is closed we keep its data for 90 days so you can still export it, then delete it, except where the law requires us to keep records.</p>
      <H>11. Changes and law</H>
      <p>We may update these terms; we will tell you and ask you to agree to the new version. These terms are governed by the laws of {LEGAL.country}, and disputes go to its courts.</p>
      <H>12. Contact</H>
      <p>Questions about these terms: write to us through {LEGAL.contact}.</p>
    </Page>
  )
}

export function Privacy() {
  return (
    <Page title="Privacy policy">
      <p>This policy explains what personal information {LEGAL.operator} collects when you use Pluto, why, and what you can do about it.</p>
      <H>1. What we collect</H>
      <ul>
        <li><strong>About you:</strong> your name, e-mail, phone (if given), password (stored only in scrambled form, never readable) and 2-step verification settings.</li>
        <li><strong>How you use Pluto:</strong> sign-ins, devices and browser, and the activity log of changes in your company (who did what and when).</li>
        <li><strong>Your business data:</strong> what your company enters, including details of its customers and suppliers. For this data your business decides what is collected; we only store and process it to run Pluto for you.</li>
      </ul>
      <H>2. Why we use it</H>
      <p>To provide and secure the service, send e-mails you need (invitations, password resets, reminders, notifications you switched on), take backups, help you when you ask for support, and bill your subscription. We do not sell personal information or use your business data for advertising.</p>
      <H>3. Who else handles it</H>
      <p>Only service providers that help us run Pluto, under their own privacy and security commitments: our hosting provider, our e-mail delivery service, and our error monitoring service (which receives technical error details without your business amounts or names). We may share information when the law requires it.</p>
      <H>4. How long we keep it</H>
      <p>While your company uses Pluto, and for 90 days after it closes so you can still export your data; backups expire on their own schedule. Accounting records may be kept longer where the law requires.</p>
      <H>5. Security</H>
      <p>Encrypted connections (HTTPS), scrambled passwords, optional 2-step verification, each company’s data kept apart, daily backups, and an activity log of every change.</p>
      <H>6. Your choices</H>
      <ul>
        <li>See and correct your profile in Settings › Security and your company’s data in Pluto itself.</li>
        <li>An Owner can export all of the company’s data at any time.</li>
        <li>Ask us to delete your account or your company’s data, subject to records the law requires us to keep.</li>
      </ul>
      <H>7. Contact</H>
      <p>Privacy questions or requests: write to us through {LEGAL.contact}.</p>
    </Page>
  )
}
