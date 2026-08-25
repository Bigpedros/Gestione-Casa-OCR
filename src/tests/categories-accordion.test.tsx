import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { db } from '../database/db';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';
import { LicenseProvider } from '../context/LicenseContext';
import { AppLayout } from '../components/layout/AppLayout';
import { CategoriesSettingsPage } from '../features/settings/CategoriesSettingsPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ROUTES } from '../app/routes';

function renderCategoriesPage() {
  return render(
    <MemoryRouter initialEntries={[ROUTES.SETTINGS_CATEGORIES]}>
      <LicenseProvider>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path={ROUTES.SETTINGS} element={<SettingsPage />} />
            <Route path={ROUTES.SETTINGS_CATEGORIES} element={<CategoriesSettingsPage />} />
          </Route>
        </Routes>
      </LicenseProvider>
    </MemoryRouter>,
  );
}

describe('Lotto 3: Categories and Subcategories Accordion Optimization', () => {
  beforeEach(async () => {
    await db.categories.clear();
    await db.settings.clear();
    await seedInitialCategoriesAndSettings();
  });

  it('Gabbia B: renders header, breadcrumbs, "Torna a Impostazioni" and NO sidebar', async () => {
    const { container } = renderCategoriesPage();

    await waitFor(() => {
      expect(screen.getByText('Categorie e Sottocategorie')).toBeInTheDocument();
    });

    // Global Header present
    expect(screen.getByText('Gestione Casa')).toBeInTheDocument();

    // Secondary route: Sidebar is null (Gabbia B)
    expect(container.querySelector('aside')).toBeNull();

    // "Torna a Impostazioni" button is present and links to /settings
    const backBtn = screen.getByRole('link', { name: /Torna a Impostazioni/i });
    expect(backBtn).toBeInTheDocument();
    expect(backBtn).toHaveAttribute('href', ROUTES.SETTINGS);
  });

  it('All categories are initially compressed / collapsed', async () => {
    renderCategoriesPage();

    await waitFor(() => {
      expect(screen.getByText('Alimentazione')).toBeInTheDocument();
    });

    // Subcategories like "Supermercato" should NOT be visible initially
    expect(screen.queryByText('Supermercato')).toBeNull();
    expect(screen.queryByText('Panetteria')).toBeNull();
    expect(screen.queryByText('Affitto o mutuo')).toBeNull();

    // All accordion headers should have aria-expanded="false"
    const headerButtons = screen.getAllByRole('button', { expanded: false });
    expect(headerButtons.length).toBeGreaterThanOrEqual(10);
  });

  it('Clicking a category accordion opens it and reveals its subcategories', async () => {
    renderCategoriesPage();

    await waitFor(() => {
      expect(screen.getByText('Alimentazione')).toBeInTheDocument();
    });

    const alimentazioneButton = screen.getByRole('button', { name: /Alimentazione/i });
    expect(alimentazioneButton).toHaveAttribute('aria-expanded', 'false');

    // Click to open
    await act(async () => {
      fireEvent.click(alimentazioneButton);
    });

    expect(alimentazioneButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Supermercato')).toBeInTheDocument();
    expect(screen.getByText('Panetteria')).toBeInTheDocument();
    expect(screen.getByText('Ristoranti e bar')).toBeInTheDocument();
  });

  it('Only ONE category can be open at a time (opening category B closes category A)', async () => {
    renderCategoriesPage();

    await waitFor(() => {
      expect(screen.getByText('Alimentazione')).toBeInTheDocument();
      expect(screen.getByText('Casa')).toBeInTheDocument();
    });

    const alimentazioneBtn = screen.getByRole('button', { name: /Alimentazione/i });
    const casaBtn = screen.getByRole('button', { name: /Casa/i });

    // Open Alimentazione
    await act(async () => {
      fireEvent.click(alimentazioneBtn);
    });
    expect(screen.getByText('Supermercato')).toBeInTheDocument();
    expect(screen.queryByText('Affitto o mutuo')).toBeNull();
    expect(alimentazioneBtn).toHaveAttribute('aria-expanded', 'true');
    expect(casaBtn).toHaveAttribute('aria-expanded', 'false');

    // Open Casa -> Alimentazione must automatically close
    await act(async () => {
      fireEvent.click(casaBtn);
    });
    expect(casaBtn).toHaveAttribute('aria-expanded', 'true');
    expect(alimentazioneBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Affitto o mutuo')).toBeInTheDocument();
    expect(screen.queryByText('Supermercato')).toBeNull();
  });

  it('A second click on the open category closes it (toggling back to collapsed)', async () => {
    renderCategoriesPage();

    await waitFor(() => {
      expect(screen.getByText('Trasporti')).toBeInTheDocument();
    });

    const trasportiBtn = screen.getByRole('button', { name: /Trasporti/i });

    // First click: Open
    await act(async () => {
      fireEvent.click(trasportiBtn);
    });
    expect(trasportiBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Carburante')).toBeInTheDocument();

    // Second click: Close
    await act(async () => {
      fireEvent.click(trasportiBtn);
    });
    expect(trasportiBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Carburante')).toBeNull();
  });

  it('Search filters categories by name', async () => {
    renderCategoriesPage();

    await waitFor(() => {
      expect(screen.getByText('Alimentazione')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Cerca categorie o sottocategorie...');

    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Salute' } });
    });

    expect(screen.getByText('Salute')).toBeInTheDocument();
    expect(screen.queryByText('Alimentazione')).toBeNull();
    expect(screen.queryByText('Trasporti')).toBeNull();
  });

  it('Search matches subcategory and displays its parent category', async () => {
    renderCategoriesPage();

    await waitFor(() => {
      expect(screen.getByText('Alimentazione')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText('Cerca categorie o sottocategorie...');

    // Search for a subcategory name like "Dentista" (under "Salute")
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Dentista' } });
    });

    // Parent category "Salute" is found and displayed
    expect(screen.getByText('Salute')).toBeInTheDocument();
    expect(screen.queryByText('Alimentazione')).toBeNull();
    expect(screen.queryByText('Tecnologia')).toBeNull();

    // Expanding "Salute" shows the matching subcategory
    const saluteBtn = screen.getByRole('button', { name: /Salute/i });
    await act(async () => {
      fireEvent.click(saluteBtn);
    });
    expect(screen.getByText('Dentista')).toBeInTheDocument();
  });

  it('Subcategory creation automatically expands the parent category', async () => {
    renderCategoriesPage();

    await waitFor(() => {
      expect(screen.getByText('Tecnologia')).toBeInTheDocument();
    });

    const techBtn = screen.getByRole('button', { name: /Tecnologia/i });

    // Open Tecnologia
    await act(async () => {
      fireEvent.click(techBtn);
    });

    // Click Aggiungi Sottocategoria
    const addSubBtn = screen.getByRole('button', { name: /Aggiungi Sottocategoria/i });
    await act(async () => {
      fireEvent.click(addSubBtn);
    });

    // Fill subcategory name and submit
    const subInput = screen.getByPlaceholderText('es. Veterinario');
    await act(async () => {
      fireEvent.change(subInput, { target: { value: 'Console da Gioco' } });
    });

    const saveSubBtn = screen.getByRole('button', { name: 'Salva Sottocategoria' });
    await act(async () => {
      fireEvent.click(saveSubBtn);
    });

    // Subcategory should appear and parent should remain/be expanded
    await waitFor(() => {
      expect(screen.getByText('Console da Gioco')).toBeInTheDocument();
    });
    expect(techBtn).toHaveAttribute('aria-expanded', 'true');
  });

  it('Accessibility attributes are properly defined (aria-controls, aria-labelledby, region)', async () => {
    const { container } = renderCategoriesPage();

    await waitFor(() => {
      expect(screen.getByText('Alimentazione')).toBeInTheDocument();
    });

    const parentBtn = screen.getByRole('button', { name: /Alimentazione/i });
    const ariaControlsId = parentBtn.getAttribute('aria-controls');
    expect(ariaControlsId).toBeTruthy();

    await act(async () => {
      fireEvent.click(parentBtn);
    });

    const region = container.querySelector(`#${ariaControlsId}`);
    expect(region).not.toBeNull();
    expect(region?.getAttribute('role')).toBe('region');
    expect(region?.getAttribute('aria-labelledby')).toBe(parentBtn.id);
  });
});
