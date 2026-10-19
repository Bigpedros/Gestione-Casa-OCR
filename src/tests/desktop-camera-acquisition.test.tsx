import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { db } from '../database/db';
import { ScanReceiptModal, isMobileDevice } from '../features/attachments/ScanReceiptModal';
import { documentSessionRepository, documentPageSegmentRepository } from '../repositories';

describe('PC-01 — ACQUISIZIONE DIRETTA DA WEBCAM SU DESKTOP', () => {
  let mockTracks: Array<{ stop: ReturnType<typeof vi.fn>; kind: string }>;
  let mockStream: any;
  let getUserMediaMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await db.delete();
    await db.open();

    mockTracks = [
      { stop: vi.fn(), kind: 'video' },
    ];

    mockStream = {
      getTracks: () => mockTracks,
      getVideoTracks: () => mockTracks.filter((t) => t.kind === 'video'),
    };

    getUserMediaMock = vi.fn().mockResolvedValue(mockStream);

    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: getUserMediaMock,
      },
      writable: true,
      configurable: true,
    });

    // Mock HTMLCanvasElement toBlob and getContext
    HTMLCanvasElement.prototype.toBlob = vi.fn(function (callback: (b: Blob | null) => void) {
      const blob = new Blob(['mock-image-bytes'], { type: 'image/jpeg' });
      callback(blob);
    });

    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
      drawImage: vi.fn(),
    }) as any;

    // Mock HTMLVideoElement play
    HTMLVideoElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('PC-01-T01: Desktop + getUserMedia disponibile: il comando fotocamera richiede uno stream video (audio: false)', async () => {
    const handleScanComplete = vi.fn();
    const handleClose = vi.fn();

    render(
      <ScanReceiptModal
        isOpen={true}
        onClose={handleClose}
        onScanComplete={handleScanComplete}
      />
    );

    // Click "Scatta con Fotocamera"
    const cameraButton = await screen.findByRole('button', { name: /Scatta con Fotocamera/i });
    expect(cameraButton).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(cameraButton);
    });

    // Verify getUserMedia was called with audio: false and video constraint
    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    });

    const callArgs = getUserMediaMock.mock.calls[0][0];
    expect(callArgs.audio).toBe(false);
    expect(callArgs.video).toBeDefined();

    // Verify Anteprima Fotocamera view is active
    expect(screen.getByText('Anteprima Fotocamera')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Scatta/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Annulla/i })).toBeInTheDocument();
  });

  it('PC-01-T02: Scatto: il frame prodotto viene inoltrato al normale flusso di acquisizione come immagine/File', async () => {
    const handleScanComplete = vi.fn();
    const handleClose = vi.fn();

    render(
      <ScanReceiptModal
        isOpen={true}
        onClose={handleClose}
        onScanComplete={handleScanComplete}
      />
    );

    // Start webcam
    const cameraButton = await screen.findByRole('button', { name: /Scatta con Fotocamera/i });
    await act(async () => {
      fireEvent.click(cameraButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Anteprima Fotocamera')).toBeInTheDocument();
    });

    // Press "Scatta"
    const shootButton = screen.getByRole('button', { name: /Scatta/i });
    await act(async () => {
      fireEvent.click(shootButton);
    });

    // Verify stream was stopped after shoot
    expect(mockTracks[0].stop).toHaveBeenCalled();

    // Verify segment was created and step transitioned to pages
    await waitFor(async () => {
      const sessions = await documentSessionRepository.getDraftSessions();
      expect(sessions.length).toBe(1);
      const segments = await documentPageSegmentRepository.getBySessionId(sessions[0].id);
      expect(segments.length).toBe(1);
      expect(segments[0].metadata?.acquisitionSource).toBe('camera_direct');
    });
  });

  it('PC-01-T03: Annulla: tutte le track vengono fermate', async () => {
    const handleScanComplete = vi.fn();
    const handleClose = vi.fn();

    render(
      <ScanReceiptModal
        isOpen={true}
        onClose={handleClose}
        onScanComplete={handleScanComplete}
      />
    );

    // Start webcam
    const cameraButton = await screen.findByRole('button', { name: /Scatta con Fotocamera/i });
    await act(async () => {
      fireEvent.click(cameraButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Anteprima Fotocamera')).toBeInTheDocument();
    });

    // Click "Annulla" inside the webcam view
    const cancelButton = screen.getByRole('button', { name: /Annulla/i });
    await act(async () => {
      fireEvent.click(cancelButton);
    });

    // Verify tracks were stopped
    expect(mockTracks[0].stop).toHaveBeenCalled();

    // Verify returned to source picker
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Scatta con Fotocamera/i })).toBeInTheDocument();
    });
  });

  it('PC-01-T04: Chiusura modal / unmount: tutte le track vengono fermate', async () => {
    const handleScanComplete = vi.fn();
    const handleClose = vi.fn();

    const { unmount } = render(
      <ScanReceiptModal
        isOpen={true}
        onClose={handleClose}
        onScanComplete={handleScanComplete}
      />
    );

    // Start webcam
    const cameraButton = await screen.findByRole('button', { name: /Scatta con Fotocamera/i });
    await act(async () => {
      fireEvent.click(cameraButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Anteprima Fotocamera')).toBeInTheDocument();
    });

    // Unmount modal
    unmount();

    // Verify tracks were stopped
    expect(mockTracks[0].stop).toHaveBeenCalled();
  });

  it('PC-01-T05: Permesso negato (NotAllowedError): errore comprensibile e possibilità di usare file picker', async () => {
    const permError = new Error('Permission denied');
    permError.name = 'NotAllowedError';
    getUserMediaMock.mockRejectedValueOnce(permError);

    const handleScanComplete = vi.fn();
    const handleClose = vi.fn();

    render(
      <ScanReceiptModal
        isOpen={true}
        onClose={handleClose}
        onScanComplete={handleScanComplete}
      />
    );

    const cameraButton = await screen.findByRole('button', { name: /Scatta con Fotocamera/i });
    await act(async () => {
      fireEvent.click(cameraButton);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Permesso fotocamera negato. Consenti l'accesso alla fotocamera oppure seleziona un'immagine dal dispositivo./i)
      ).toBeInTheDocument();
    });

    // Verify file picker options are still accessible
    expect(screen.getByRole('button', { name: /Scegli Immagini/i })).toBeInTheDocument();
  });

  it('PC-01-T06: Assenza webcam (NotFoundError): nessun crash e fallback disponibile', async () => {
    const notFoundError = new Error('No device found');
    notFoundError.name = 'NotFoundError';
    getUserMediaMock.mockRejectedValueOnce(notFoundError);

    const handleScanComplete = vi.fn();
    const handleClose = vi.fn();

    render(
      <ScanReceiptModal
        isOpen={true}
        onClose={handleClose}
        onScanComplete={handleScanComplete}
      />
    );

    const cameraButton = await screen.findByRole('button', { name: /Scatta con Fotocamera/i });
    await act(async () => {
      fireEvent.click(cameraButton);
    });

    await waitFor(() => {
      expect(screen.getByText(/Nessuna fotocamera disponibile./i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Scegli Immagini/i })).toBeInTheDocument();
  });

  it('PC-01-T07: Helper isMobileDevice identifica correttamente desktop vs mobile', () => {
    // In standard node/jsdom without touch points or mobile userAgent
    expect(isMobileDevice()).toBe(false);
  });
});
