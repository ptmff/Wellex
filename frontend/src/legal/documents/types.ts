export type LegalSection = {
  title: string;
  paragraphs: string[];
  list?: string[];
};

export type LegalDocumentContent = {
  updatedAt: string;
  sections: LegalSection[];
};
