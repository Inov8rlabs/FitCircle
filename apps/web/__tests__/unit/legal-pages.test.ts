import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Source-level checks for the public legal pages (privacy policy v1.3 and friends).
// Reads the files instead of rendering them so the test stays fast and dependency-free.
const APP = join(__dirname, '..', '..', 'app');
const read = (rel: string) => readFileSync(join(APP, rel), 'utf8');

describe('legal pages', () => {
  const privacy = read('privacy/page.tsx');

  it('privacy policy v1.3 names the right controller and covers the audit gaps', () => {
    expect(privacy).toContain('Inov8r Labs Inc.');
    expect(privacy).not.toContain('FitCircle Inc.');
    expect(privacy).toMatch(/POLICY_VERSION = '1\.3'/);
    expect(privacy).toContain('Resend');
    expect(privacy).toContain('Canada and Quebec:');
    expect(privacy).not.toMatch(/IDTA|International Data Transfer Addendum/);
    expect(privacy).toContain('Grievance Officer');
    expect(privacy).toContain('Quebec');
    expect(privacy).toContain('Singapore');
    expect(privacy).toContain('/consumer-health-privacy');
    expect(privacy).toContain('/privacy-choices');
    expect(privacy).toContain('/fr/privacy');
    expect(privacy).not.toContain('Draft — pending legal review');
    expect(privacy).toContain('If you do not use FitCircle for 3 years');
    // Explicit consent is not a transfer mechanism.
    expect(privacy).not.toContain('Your explicit consent for health data processing');
  });

  it('shows the registered office address and no placeholders', () => {
    expect(privacy).toContain('485 - 6400 Roberts Street, Burnaby, British Columbia V5G 4C9, Canada');
    expect(privacy).not.toContain('[PLACEHOLDER');
  });

  it('consumer health data policy and privacy choices pages exist', () => {
    expect(existsSync(join(APP, 'consumer-health-privacy/page.tsx'))).toBe(true);
    expect(existsSync(join(APP, 'privacy-choices/page.tsx'))).toBe(true);
    const chd = read('consumer-health-privacy/page.tsx');
    expect(chd).toContain('45 days');
    expect(chd).toContain('geofencing');
    expect(read('privacy-choices/page.tsx')).toContain('/settings/privacy');
  });

  it('French pages carry the machine-translation notice and lang="fr"', () => {
    for (const rel of ['fr/privacy/page.tsx', 'fr/terms/page.tsx']) {
      const src = read(rel);
      expect(src).toContain('Traduction automatique — en attente de révision humaine');
      expect(src).toContain('Machine translation pending human review');
      expect(src).toContain('lang="fr"');
    }
  });

  it('terms name Inov8r Labs, the service area, and drop bundled consent', () => {
    const terms = read('terms/page.tsx');
    expect(terms).toContain('Inov8r Labs Inc.');
    expect(terms).toContain('The Service is offered in the United States, Canada, India and Singapore');
    expect(terms).not.toMatch(/you consent\s+to our data practices/);
    expect(terms).toContain('/fr/terms');
  });

  it('all legal pages name the BC corporation and drop the US governing law', () => {
    for (const rel of [
      'privacy/page.tsx',
      'terms/page.tsx',
      'consumer-health-privacy/page.tsx',
      'fr/privacy/page.tsx',
      'fr/terms/page.tsx',
    ]) {
      const src = read(rel);
      expect(src, rel).toContain('BC1310005');
      expect(src, rel).not.toContain('Delaware');
      expect(src, rel).not.toContain('registered postal address');
    }
    for (const rel of ['privacy/page.tsx', 'terms/page.tsx', 'consumer-health-privacy/page.tsx']) {
      expect(read(rel), rel).toContain('British Columbia');
    }
    for (const rel of ['privacy/page.tsx', 'fr/privacy/page.tsx']) {
      const src = read(rel);
      expect(src, rel).toContain('PIPA');
      expect(src, rel).toMatch(/Information\s+and\s+Privacy\s+Commissioner\s+for\s+British\s+Columbia/);
      expect(src, rel).not.toMatch(/based in the United States|établis aux États-Unis/);
    }
    for (const rel of ['privacy/page.tsx', 'fr/privacy/page.tsx', 'terms/page.tsx', 'fr/terms/page.tsx']) {
      const src = read(rel);
      expect(src, rel).not.toMatch(/United Kingdom|Royaume-Uni|\bUK\b|R\.-U\.|ico\.org\.uk|Art\. 27|art\. 27/);
      expect(src, rel).not.toContain('UK representative');
    }
    expect(privacy).toMatch(/does\s+not\s+accept\s+new\s+sign-ups\s+from\s+the\s+European\s+Union/);
    expect(read('terms/page.tsx')).toMatch(/laws\s+of\s+the\s+Province\s+of\s+British\s+Columbia/);
  });

  it('meals are described as private by default', () => {
    expect(privacy).toMatch(/private\s+by\s+default/);
    expect(read('consumer-health-privacy/page.tsx')).toMatch(/private\s+by\s+default/);
  });

  it('homepage footer links the consumer health policy and privacy choices', () => {
    const home = read('page.tsx');
    expect(home).toContain('href="/consumer-health-privacy"');
    expect(home).toContain('href="/privacy-choices"');
  });
});
