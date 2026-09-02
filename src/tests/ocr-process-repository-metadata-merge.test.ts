import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '../database/db';
import { ocrProcessRepository } from '../repositories';

describe('FASE P4-D1-E2E-R2-F1 — Test Merge Metadata ocrProcessRepository', () => {
  beforeEach(async () => {
    await db.ocrProcesses.clear();
  });

  it('TEST 1: metadata preesistente viene preservato', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-1',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    await db.ocrProcesses.update(created.id, {
      metadata: {
        ...created.metadata,
        customInitialField: 'preserve_me',
        initialCounter: 42,
      } as any,
    });

    await ocrProcessRepository.update(created.id, {
      status: 'processing',
      metadata: {
        newField: 'added_value',
      },
    });

    const retrieved = await ocrProcessRepository.getById(created.id);
    expect(retrieved).toBeDefined();
    expect((retrieved?.metadata as any).customInitialField).toBe('preserve_me');
    expect((retrieved?.metadata as any).initialCounter).toBe(42);
    expect((retrieved?.metadata as any).newField).toBe('added_value');
    expect((retrieved?.metadata as any).createdAt).toBe(created.metadata.createdAt);
  });

  it('TEST 2: updates.metadata viene realmente persistito', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-2',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(created.id, {
      status: 'completed',
      metadata: {
        pipelineStatus: 'ok',
        customMetadataKey: 'custom_value_123',
      },
    });

    const inDb = await ocrProcessRepository.getById(created.id);
    expect((inDb?.metadata as any).pipelineStatus).toBe('ok');
    expect((inDb?.metadata as any).customMetadataKey).toBe('custom_value_123');
  });

  it('TEST 3: selectedVariant viene persistito', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-3',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(created.id, {
      status: 'completed',
      metadata: {
        selectedVariant: 'gentle_contrast',
      },
    });

    const inDb = await ocrProcessRepository.getById(created.id);
    expect((inDb?.metadata as any).selectedVariant).toBe('gentle_contrast');
  });

  it('TEST 4: variantScores viene persistito', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-4',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    const scores = [
      { variant: 'original', score: 65, details: { totalDetected: true } },
      { variant: 'gentle_contrast', score: 88, details: { totalDetected: true, linesDetected: 8 } },
    ];

    await ocrProcessRepository.update(created.id, {
      status: 'completed',
      metadata: {
        variantScores: scores,
      },
    });

    const inDb = await ocrProcessRepository.getById(created.id);
    expect((inDb?.metadata as any).variantScores).toEqual(scores);
    expect((inDb?.metadata as any).variantScores.length).toBe(2);
    expect((inDb?.metadata as any).variantScores[1].score).toBe(88);
  });

  it('TEST 5: detectedPaymentMethod viene persistito', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-5',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    await ocrProcessRepository.update(created.id, {
      status: 'completed',
      metadata: {
        detectedPaymentMethod: 'debitCard',
      },
    });

    const inDb = await ocrProcessRepository.getById(created.id);
    expect((inDb?.metadata as any).detectedPaymentMethod).toBe('debitCard');
  });

  it('TEST 6: normalizedLines viene persistito', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-6',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    const lines = [
      { index: 0, raw: 'FARMACIA LA NAVE', normalized: 'FARMACIA LA NAVE' },
      { index: 1, raw: 'IMPORTO: EUR 8,02', normalized: 'IMPORTO EUR 8.02' },
    ];

    await ocrProcessRepository.update(created.id, {
      status: 'completed',
      metadata: {
        normalizedLines: lines,
      },
    });

    const inDb = await ocrProcessRepository.getById(created.id);
    expect((inDb?.metadata as any).normalizedLines).toEqual(lines);
  });

  it('TEST 7: updatedAt cambia', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-7',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    const initialUpdatedAt = created.metadata.updatedAt;

    // Small delay to ensure timestamp difference
    await new Promise((r) => setTimeout(r, 10));

    const updated = await ocrProcessRepository.update(created.id, {
      status: 'processing',
    });

    expect(updated.metadata.updatedAt).not.toBe(initialUpdatedAt);
    expect(new Date(updated.metadata.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(initialUpdatedAt).getTime()
    );
  });

  it('TEST 8: version viene incrementata di 1', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-8',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    expect(created.metadata.version).toBe(1);

    const updated1 = await ocrProcessRepository.update(created.id, {
      status: 'processing',
    });
    expect(updated1.metadata.version).toBe(2);

    const updated2 = await ocrProcessRepository.update(created.id, {
      status: 'completed',
    });
    expect(updated2.metadata.version).toBe(3);

    const inDb = await ocrProcessRepository.getById(created.id);
    expect(inDb?.metadata.version).toBe(3);
  });

  it('TEST 9: una update senza updates.metadata non cancella metadata esistente', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-9',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    await db.ocrProcesses.update(created.id, {
      metadata: {
        ...created.metadata,
        selectedVariant: 'sharpened_light',
        detectedPaymentMethod: 'creditCard',
      } as any,
    });

    // Update passing only top-level fields (no metadata in updates)
    await ocrProcessRepository.update(created.id, {
      status: 'completed',
      detectedTotal: 25.5,
    });

    const inDb = await ocrProcessRepository.getById(created.id);
    expect((inDb?.metadata as any).selectedVariant).toBe('sharpened_light');
    expect((inDb?.metadata as any).detectedPaymentMethod).toBe('creditCard');
    expect(inDb?.detectedTotal).toBe(25.5);
    expect(inDb?.metadata.version).toBe(2);
  });

  it('TEST 10: un campo metadata aggiornato sovrascrive correttamente il valore precedente dello stesso campo', async () => {
    const created = await ocrProcessRepository.create({
      attachmentId: 'att-10',
      status: 'pending',
      confirmationRequired: false,
      confirmedByUser: false,
    });

    await db.ocrProcesses.update(created.id, {
      metadata: {
        ...created.metadata,
        selectedVariant: 'original',
        score: 50,
        stickyFlag: 'keep_this',
      } as any,
    });

    await ocrProcessRepository.update(created.id, {
      metadata: {
        selectedVariant: 'gentle_contrast',
        score: 95,
      },
    });

    const inDb = await ocrProcessRepository.getById(created.id);
    expect((inDb?.metadata as any).selectedVariant).toBe('gentle_contrast');
    expect((inDb?.metadata as any).score).toBe(95);
    expect((inDb?.metadata as any).stickyFlag).toBe('keep_this');
    expect(inDb?.metadata.version).toBe(2);
  });
});
