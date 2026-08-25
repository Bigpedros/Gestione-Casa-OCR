import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { LicenseProvider } from './context/LicenseContext';
import { ThemeProvider } from './context/ThemeContext';

export function App() {
  return (
    <ThemeProvider>
      <LicenseProvider>
        <RouterProvider router={router} />
      </LicenseProvider>
    </ThemeProvider>
  );
}

export default App;
