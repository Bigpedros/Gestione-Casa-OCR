import { useEffect, useState } from 'react';
import { seedInitialCategoriesAndSettings } from '../database/seed/seedCategories';

export function useSeedData() {
  const [isSeeded, setIsSeeded] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let isMounted = true;
    seedInitialCategoriesAndSettings()
      .then(() => {
        if (isMounted) setIsSeeded(true);
      })
      .catch((err) => {
        console.warn('Avviso durante l\'inizializzazione del database:', err);
        if (isMounted) {
          setError(err);
          setIsSeeded(true);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return { isSeeded, error };
}
