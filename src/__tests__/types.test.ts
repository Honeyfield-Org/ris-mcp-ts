import { describe, it, expect } from 'vitest';

import { limitToDokumenteProSeite, JudikaturGerichtSchema, LimitSchema } from '../types.js';

describe('limitToDokumenteProSeite', () => {
  it("returns 'Ten' for limit 10", () => {
    expect(limitToDokumenteProSeite(10)).toBe('Ten');
  });

  it("returns 'Twenty' for limit 20", () => {
    expect(limitToDokumenteProSeite(20)).toBe('Twenty');
  });

  it("returns 'Fifty' for limit 50", () => {
    expect(limitToDokumenteProSeite(50)).toBe('Fifty');
  });

  it("returns 'OneHundred' for limit 100", () => {
    expect(limitToDokumenteProSeite(100)).toBe('OneHundred');
  });

  it("returns 'Twenty' (default) for unknown value like 25", () => {
    expect(limitToDokumenteProSeite(25)).toBe('Twenty');
  });

  it("returns 'Twenty' (default) for invalid value 0", () => {
    expect(limitToDokumenteProSeite(0)).toBe('Twenty');
  });

  it("returns 'Twenty' (default) for invalid value -1", () => {
    expect(limitToDokumenteProSeite(-1)).toBe('Twenty');
  });

  it("returns 'Twenty' (default) for undefined", () => {
    expect(limitToDokumenteProSeite(undefined as unknown as number)).toBe('Twenty');
  });
});

describe('JudikaturGerichtSchema', () => {
  const expectedGerichte = [
    'Justiz',
    'Vfgh',
    'Vwgh',
    'Bvwg',
    'Lvwg',
    'Dsk',
    'AsylGH',
    'Normenliste',
    'Pvak',
    'Gbk',
    'Dok',
    'Verg',
    'Uvs',
    'Ubas',
    'Umse',
    'Bks',
  ];

  it('should accept all 16 court/jurisdiction types', () => {
    const schemaValues = JudikaturGerichtSchema.options;
    expect(schemaValues).toHaveLength(16);
  });

  it.each(expectedGerichte)("should validate '%s' as a valid court type", (gericht) => {
    const result = JudikaturGerichtSchema.safeParse(gericht);
    expect(result.success).toBe(true);
  });

  it('should reject invalid court types', () => {
    const result = JudikaturGerichtSchema.safeParse('InvalidCourt');
    expect(result.success).toBe(false);
  });

  it('should include all Phase 2 courts (AsylGH, Normenliste, Pvak, Gbk, Dok)', () => {
    const phase2Courts = ['AsylGH', 'Normenliste', 'Pvak', 'Gbk', 'Dok'];
    const schemaValues = JudikaturGerichtSchema.options;

    for (const court of phase2Courts) {
      expect(schemaValues).toContain(court);
    }
  });

  it('should include the 5 historical jurisdictions dissolved in 2014', () => {
    const historicalCourts = ['Verg', 'Uvs', 'Ubas', 'Umse', 'Bks'];
    const schemaValues = JudikaturGerichtSchema.options;

    for (const court of historicalCourts) {
      expect(schemaValues).toContain(court);
    }
  });
});

describe('LimitSchema', () => {
  it.each([10, 20, 50, 100])('should accept allowed page size %i', (limit) => {
    const result = LimitSchema.safeParse(limit);
    expect(result.success).toBe(true);
  });

  it.each([25, 0, -1, 5, 200, 15])('should reject disallowed page size %i', (limit) => {
    const result = LimitSchema.safeParse(limit);
    expect(result.success).toBe(false);
  });

  it('should default to 20 when no value is provided', () => {
    const result = LimitSchema.parse(undefined);
    expect(result).toBe(20);
  });
});
