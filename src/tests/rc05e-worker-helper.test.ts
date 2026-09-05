import { describe, it, expect, vi } from 'vitest';
import {
  executeRegionalCropRecognition,
  WorkerRestoreError,
  PRODUCTION_TESSERACT_PARAMETERS,
  REGIONAL_TESSERACT_PARAMETERS,
} from '../services/ocrParser/regional/regionalWorkerHelper';
import { PixelCropBox } from '../services/ocrParser/regional/types';

describe('RC-05E: Regional OCR Worker Helper', () => {
  const cropBox: PixelCropBox = {
    left: 100,
    top: 200,
    width: 300,
    height: 400,
  };

  it('sets PSM 6 without whitelist, executes recognize with rectangle, and restores PSM 4 in finally', async () => {
    const callLog: string[] = [];
    const parameterCalls: any[] = [];

    const mockWorker = {
      setParameters: vi.fn(async (params) => {
        callLog.push('setParameters');
        parameterCalls.push({ ...params });
      }),
      recognize: vi.fn(async (_img, _options) => {
        callLog.push('recognize');
        return {
          data: {
            text: '12,44\n12,20',
            confidence: 85,
          },
        };
      }),
    };

    const result = await executeRegionalCropRecognition(mockWorker as any, 'mock_image_source', cropBox);

    expect(result.text).toBe('12,44\n12,20');
    expect(result.confidence).toBe(85);

    // Call order: setParameters (PSM 6) -> recognize -> setParameters (restore PSM 4)
    expect(callLog).toEqual(['setParameters', 'recognize', 'setParameters']);

    // 1st call: regional parameters (PSM 6, no whitelist)
    expect(parameterCalls[0]).toEqual(REGIONAL_TESSERACT_PARAMETERS);
    expect(parameterCalls[0].tessedit_pageseg_mode).toBe('6');
    expect(parameterCalls[0].tessedit_char_whitelist).toBeUndefined();

    // Recognize call rectangle
    expect(mockWorker.recognize).toHaveBeenCalledWith('mock_image_source', {
      rectangle: {
        left: 100,
        top: 200,
        width: 300,
        height: 400,
      },
    });

    // 2nd call: restore production parameters (PSM 4)
    expect(parameterCalls[1]).toEqual(PRODUCTION_TESSERACT_PARAMETERS);
    expect(parameterCalls[1].tessedit_pageseg_mode).toBe('4');
  });

  it('guarantees parameter restore even if recognize throws an error', async () => {
    const parameterCalls: any[] = [];

    const mockWorker = {
      setParameters: vi.fn(async (params) => {
        parameterCalls.push({ ...params });
      }),
      recognize: vi.fn(async () => {
        throw new Error('OCR recognition failure');
      }),
    };

    await expect(
      executeRegionalCropRecognition(mockWorker as any, 'mock_image_source', cropBox)
    ).rejects.toThrow('OCR recognition failure');

    // Restore must still have been called
    expect(parameterCalls).toHaveLength(2);
    expect(parameterCalls[0].tessedit_pageseg_mode).toBe('6');
    expect(parameterCalls[1].tessedit_pageseg_mode).toBe('4');
  });

  it('propagates WorkerRestoreError if setParameters fails during restore in finally', async () => {
    let callCount = 0;
    const mockWorker = {
      setParameters: vi.fn(async () => {
        callCount++;
        if (callCount === 2) {
          throw new Error('Worker communication failure on restore');
        }
      }),
      recognize: vi.fn(async () => ({
        data: { text: 'test', confidence: 90 },
      })),
    };

    await expect(
      executeRegionalCropRecognition(mockWorker as any, 'mock_image_source', cropBox)
    ).rejects.toThrow(WorkerRestoreError);
  });
});
