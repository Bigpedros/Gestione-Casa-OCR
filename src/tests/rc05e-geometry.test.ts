import { describe, it, expect } from 'vitest';
import {
  resolveRelativeCropBox,
  InvalidGeometryError,
  SHADOW_REFERENCE_POLICY,
} from '../services/ocrParser/regional/geometry';
import { RelativeCropBox } from '../services/ocrParser/regional/types';

describe('RC-05E: Regional Geometry Module', () => {
  it('converts valid relative percentages to pixel coordinates accurately', () => {
    const box: RelativeCropBox = {
      xPct: 55,
      yPct: 22,
      widthPct: 45,
      heightPct: 50,
    };
    // Image 1000 x 2000
    const pixelBox = resolveRelativeCropBox(1000, 2000, box);

    expect(pixelBox.left).toBe(550);
    expect(pixelBox.top).toBe(440);
    expect(pixelBox.width).toBe(450);
    expect(pixelBox.height).toBe(1000);
    expect(pixelBox.left + pixelBox.width).toBeLessThanOrEqual(1000);
    expect(pixelBox.top + pixelBox.height).toBeLessThanOrEqual(2000);
  });

  it('rejects non-positive or non-finite image dimensions', () => {
    const validBox: RelativeCropBox = { xPct: 10, yPct: 10, widthPct: 50, heightPct: 50 };

    expect(() => resolveRelativeCropBox(0, 1000, validBox)).toThrow(InvalidGeometryError);
    expect(() => resolveRelativeCropBox(-500, 1000, validBox)).toThrow(InvalidGeometryError);
    expect(() => resolveRelativeCropBox(1000, 0, validBox)).toThrow(InvalidGeometryError);
    expect(() => resolveRelativeCropBox(NaN, 1000, validBox)).toThrow(InvalidGeometryError);
    expect(() => resolveRelativeCropBox(1000, Infinity, validBox)).toThrow(InvalidGeometryError);
  });

  it('rejects relative percentages out of range', () => {
    expect(() =>
      resolveRelativeCropBox(1000, 1000, { xPct: -5, yPct: 10, widthPct: 50, heightPct: 50 })
    ).toThrow(InvalidGeometryError);

    expect(() =>
      resolveRelativeCropBox(1000, 1000, { xPct: 105, yPct: 10, widthPct: 50, heightPct: 50 })
    ).toThrow(InvalidGeometryError);

    expect(() =>
      resolveRelativeCropBox(1000, 1000, { xPct: 10, yPct: 10, widthPct: 0, heightPct: 50 })
    ).toThrow(InvalidGeometryError);

    expect(() =>
      resolveRelativeCropBox(1000, 1000, { xPct: 10, yPct: 10, widthPct: 50, heightPct: -20 })
    ).toThrow(InvalidGeometryError);

    expect(() =>
      resolveRelativeCropBox(1000, 1000, { xPct: NaN, yPct: 10, widthPct: 50, heightPct: 50 })
    ).toThrow(InvalidGeometryError);
  });

  it('clamps rectangle at canvas boundaries when widthPct or heightPct exceed available space', () => {
    // xPct = 80, widthPct = 50 -> left = 800, max available width = 200
    const pixelBox = resolveRelativeCropBox(1000, 1000, {
      xPct: 80,
      yPct: 80,
      widthPct: 50,
      heightPct: 50,
    });

    expect(pixelBox.left).toBe(800);
    expect(pixelBox.top).toBe(800);
    expect(pixelBox.width).toBe(200); // Clamped from 500 to 200
    expect(pixelBox.height).toBe(200); // Clamped from 500 to 200
    expect(pixelBox.left + pixelBox.width).toBe(1000);
    expect(pixelBox.top + pixelBox.height).toBe(1000);
  });

  it('is completely deterministic and does not mutate input object', () => {
    const box: RelativeCropBox = { xPct: 25, yPct: 65, widthPct: 75, heightPct: 20 };
    const originalBoxSnapshot = { ...box };

    const res1 = resolveRelativeCropBox(1152, 2048, box);
    const res2 = resolveRelativeCropBox(1152, 2048, box);

    expect(res1).toEqual(res2);
    expect(box).toEqual(originalBoxSnapshot);
  });

  it('verifies SHADOW_REFERENCE_POLICY handles Pewex dimensions safely without overflow', () => {
    const pewexW = 1152;
    const pewexH = 2048;

    const bodyRect = resolveRelativeCropBox(pewexW, pewexH, SHADOW_REFERENCE_POLICY.bodyBox);
    expect(bodyRect.left).toBe(634); // Math.round(0.55 * 1152) = 634
    expect(bodyRect.top).toBe(451); // Math.round(0.22 * 2048) = 451
    expect(bodyRect.left + bodyRect.width).toBeLessThanOrEqual(pewexW);
    expect(bodyRect.top + bodyRect.height).toBeLessThanOrEqual(pewexH);

    const footerRect = resolveRelativeCropBox(pewexW, pewexH, SHADOW_REFERENCE_POLICY.footerBox);
    expect(footerRect.left).toBe(288); // Math.round(0.25 * 1152) = 288
    expect(footerRect.top).toBe(1331); // Math.round(0.65 * 2048) = 1331
    expect(footerRect.left + footerRect.width).toBeLessThanOrEqual(pewexW);
    expect(footerRect.top + footerRect.height).toBeLessThanOrEqual(pewexH);
  });
});
