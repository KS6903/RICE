// LegalService — typed client for /api/legal.
//
// The document endpoints are public, so this deliberately uses the shared axios
// instance without requiring a session: a visitor has to be able to read the
// terms before agreeing to them.
import api from "./api";

export type LegalDocumentSummary = {
  key: string;
  title: string;
  version: string;
  effective_date: string;
  summary: string;
  in_bundle: boolean;
};

export type LegalDocument = LegalDocumentSummary & {
  sha256: string;
  markdown: string;
};

export type LegalIndex = {
  agreement_version: string;
  bundle_hash: string;
  documents: LegalDocumentSummary[];
};

export type AcceptanceStatus = {
  agreement_version: string;
  acceptance_required: boolean;
  accepted_version: string | null;
  accepted_at: string | null;
  documents: { key: string; title: string; version: string; effective_date: string }[];
};

export class LegalService {
  constructor(private http = api) {}

  index(): Promise<LegalIndex> {
    return this.http.get("/legal/documents").then((r) => r.data);
  }

  document(key: string): Promise<LegalDocument> {
    return this.http.get(`/legal/documents/${key}`).then((r) => r.data);
  }

  acceptanceStatus(): Promise<AcceptanceStatus> {
    return this.http.get("/legal/acceptance").then((r) => r.data);
  }

  accept(): Promise<AcceptanceStatus> {
    return this.http.post("/legal/acceptance").then((r) => r.data);
  }
}

export const legalService = new LegalService();
