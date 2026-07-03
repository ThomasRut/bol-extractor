import { render, screen } from '@testing-library/react';
import App from './App';

test('renders the upload screen', () => {
  render(<App />);
  expect(screen.getByText(/Upload BOL PDFs/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Driver Name/i)).toBeInTheDocument();
});
