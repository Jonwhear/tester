/**
 * Reference-range data for the Lab Values panel.
 *
 * DEVELOPMENT PLACEHOLDER. This is a small, deliberately incomplete sample so
 * the panel is functional; it is not an authoritative clinical reference and
 * must be replaced with the reference table your examination actually
 * publishes. Replace the contents of `LAB_VALUE_SECTIONS` below — nothing else
 * in the application needs to change.
 */

export interface LabValueRow {
  analyte: string;
  reference: string;
  units?: string;
}

export interface LabValueSection {
  id: string;
  title: string;
  rows: LabValueRow[];
}

export const LAB_VALUES_NOTICE =
  'Sample reference ranges for interface development only. Not a clinical reference — ' +
  'replace src/data/labValues.ts with your examination’s published table.';

export const LAB_VALUE_SECTIONS: LabValueSection[] = [
  {
    id: 'hematology',
    title: 'Hematology',
    rows: [
      { analyte: 'Hemoglobin (male)', reference: '13.5 – 17.5', units: 'g/dL' },
      { analyte: 'Hemoglobin (female)', reference: '12.0 – 16.0', units: 'g/dL' },
      { analyte: 'Hematocrit (male)', reference: '41 – 53', units: '%' },
      { analyte: 'Hematocrit (female)', reference: '36 – 46', units: '%' },
      { analyte: 'Mean corpuscular volume', reference: '80 – 100', units: 'fL' },
      { analyte: 'Leukocyte count', reference: '4,500 – 11,000', units: '/mm³' },
      { analyte: 'Platelet count', reference: '150,000 – 400,000', units: '/mm³' },
      { analyte: 'Reticulocyte count', reference: '0.5 – 1.5', units: '%' },
    ],
  },
  {
    id: 'chemistry',
    title: 'Serum chemistry',
    rows: [
      { analyte: 'Sodium', reference: '136 – 146', units: 'mEq/L' },
      { analyte: 'Potassium', reference: '3.5 – 5.0', units: 'mEq/L' },
      { analyte: 'Chloride', reference: '95 – 105', units: 'mEq/L' },
      { analyte: 'Bicarbonate', reference: '22 – 28', units: 'mEq/L' },
      { analyte: 'Urea nitrogen', reference: '7 – 18', units: 'mg/dL' },
      { analyte: 'Creatinine', reference: '0.6 – 1.2', units: 'mg/dL' },
      { analyte: 'Glucose (fasting)', reference: '70 – 100', units: 'mg/dL' },
      { analyte: 'Calcium', reference: '8.4 – 10.2', units: 'mg/dL' },
    ],
  },
  {
    id: 'liver',
    title: 'Liver and pancreas',
    rows: [
      { analyte: 'Alanine aminotransferase (ALT)', reference: '10 – 40', units: 'U/L' },
      { analyte: 'Aspartate aminotransferase (AST)', reference: '12 – 38', units: 'U/L' },
      { analyte: 'Alkaline phosphatase', reference: '25 – 100', units: 'U/L' },
      { analyte: 'Bilirubin, total', reference: '0.1 – 1.0', units: 'mg/dL' },
      { analyte: 'Albumin', reference: '3.5 – 5.5', units: 'g/dL' },
      { analyte: 'Amylase', reference: '25 – 125', units: 'U/L' },
    ],
  },
  {
    id: 'abg',
    title: 'Arterial blood gas (room air)',
    rows: [
      { analyte: 'pH', reference: '7.35 – 7.45' },
      { analyte: 'PaO₂', reference: '75 – 105', units: 'mm Hg' },
      { analyte: 'PaCO₂', reference: '33 – 45', units: 'mm Hg' },
      { analyte: 'Bicarbonate', reference: '22 – 28', units: 'mEq/L' },
    ],
  },
  {
    id: 'csf',
    title: 'Cerebrospinal fluid',
    rows: [
      { analyte: 'Cell count', reference: '0 – 5', units: '/mm³' },
      { analyte: 'Glucose', reference: '40 – 70', units: 'mg/dL' },
      { analyte: 'Protein', reference: '< 40', units: 'mg/dL' },
      { analyte: 'Opening pressure', reference: '70 – 180', units: 'mm H₂O' },
    ],
  },
];
