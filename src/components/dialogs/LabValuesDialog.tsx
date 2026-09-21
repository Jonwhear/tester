import { useMemo, useState } from 'react';

import { LAB_VALUES_NOTICE, LAB_VALUE_SECTIONS } from '../../data/labValues';
import { Modal } from '../common/Modal';

export interface LabValuesDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Reference-range lookup. Content lives in `src/data/labValues.ts`. */
export function LabValuesDialog({ open, onClose }: LabValuesDialogProps) {
  const [query, setQuery] = useState('');

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return LAB_VALUE_SECTIONS;
    return LAB_VALUE_SECTIONS.map((section) => ({
      ...section,
      rows: section.rows.filter(
        (row) =>
          row.analyte.toLowerCase().includes(needle) ||
          section.title.toLowerCase().includes(needle),
      ),
    })).filter((section) => section.rows.length > 0);
  }, [query]);

  return (
    <Modal open={open} title="Lab Values" onClose={onClose} size="wide">
      <div className="banner banner--warn labs__search">{LAB_VALUES_NOTICE}</div>

      <div className="field labs__search">
        <label className="field__label" htmlFor="lab-search">
          Filter
        </label>
        <input
          id="lab-search"
          className="input"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Analyte or section…"
        />
      </div>

      {sections.length === 0 ? (
        <p className="empty-state">No entries match “{query}”.</p>
      ) : (
        sections.map((section) => (
          <section className="labs__section" key={section.id}>
            <h3 className="labs__section-title">{section.title}</h3>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Analyte</th>
                  <th scope="col">Reference range</th>
                  <th scope="col">Units</th>
                </tr>
              </thead>
              <tbody>
                {section.rows.map((row) => (
                  <tr key={row.analyte}>
                    <td>{row.analyte}</td>
                    <td>{row.reference}</td>
                    <td>{row.units ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </Modal>
  );
}
