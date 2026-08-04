import { RouterProvider } from 'react-router-dom';
import { router } from './app/router';
import { LicenseProvider } from './context/LicenseContext';

export function App() {
  return (
    <LicenseProvider>
      <RouterProvider router={router} />
    </LicenseProvider>
  );
}

export default App;
