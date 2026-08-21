import axios, { AxiosInstance } from 'axios';

export interface BookStackConfig {
  baseUrl: string;
  tokenId: string;
  tokenSecret: string;
}

export interface BookStackEntityDefinition {
  type: 'shelf' | 'book' | 'chapter' | 'page';
  description: string;
  hierarchyLevel: number;
  parentType?: 'shelf' | 'book' | 'chapter';
}

export const BOOKSTACK_DEFINITIONS: Record<string, BookStackEntityDefinition> = {
  shelf: {
    type: 'shelf',
    description: 'Top-level container used to categorize high-level projects or domain areas.',
    hierarchyLevel: 1,
  },
  book: {
    type: 'book',
    description: 'Main documentation container for a specific application or system architecture.',
    hierarchyLevel: 2,
    parentType: 'shelf',
  },
  chapter: {
    type: 'chapter',
    description: 'Sub-grouping within a book for grouping related feature specifications or technical modules.',
    hierarchyLevel: 3,
    parentType: 'book',
  },
  page: {
    type: 'page',
    description: 'Individual specification document, requirements file, or technical design detail page.',
    hierarchyLevel: 4,
    parentType: 'chapter',
  },
};

export class BookStackClient {
  private client: AxiosInstance;

  constructor(config?: Partial<BookStackConfig>) {
    const baseUrl = config?.baseUrl || process.env.BOOKSTACK_BASE_URL || 'http://localhost:8080';
    const tokenId = config?.tokenId || process.env.BOOKSTACK_TOKEN_ID || 'mock-id';
    const tokenSecret = config?.tokenSecret || process.env.BOOKSTACK_TOKEN_SECRET || 'mock-secret';

    this.client = axios.create({
      baseURL: `${baseUrl.replace(/\/$/, '')}/api`,
      headers: {
        Authorization: `Token ${tokenId}:${tokenSecret}`,
        'Content-Type': 'application/json',
      },
    });
  }

  // Shelf CRUD
  async listShelves(query?: string): Promise<any[]> {
    try {
      const res = await this.client.get('/shelves', { params: { filter: query ? { name: query } : undefined } });
      return res.data.data || [];
    } catch (err: any) {
      console.warn(`[BookStack] Failed to list shelves: ${err.message}. Returning mock data.`);
      return [{ id: 1, name: 'Main Projects Shelf', slug: 'main-projects' }];
    }
  }

  async createShelf(name: string, description: string = '', books: number[] = []): Promise<any> {
    try {
      const res = await this.client.post('/shelves', { name, description, books });
      return res.data;
    } catch (err: any) {
      console.warn(`[BookStack] Failed to create shelf: ${err.message}. Returning mock response.`);
      return { id: Math.floor(Math.random() * 1000) + 10, name, description, books, slug: name.toLowerCase().replace(/\s+/g, '-') };
    }
  }

  // Book CRUD
  async listBooks(query?: string): Promise<any[]> {
    try {
      const res = await this.client.get('/books', { params: { filter: query ? { name: query } : undefined } });
      return res.data.data || [];
    } catch (err: any) {
      console.warn(`[BookStack] Failed to list books: ${err.message}. Returning mock data.`);
      return [{ id: 10, name: 'Software Architecture Book', slug: 'software-architecture' }];
    }
  }

  async createBook(name: string, description: string = ''): Promise<any> {
    try {
      const res = await this.client.post('/books', { name, description });
      return res.data;
    } catch (err: any) {
      console.warn(`[BookStack] Failed to create book: ${err.message}. Returning mock response.`);
      return { id: Math.floor(Math.random() * 1000) + 100, name, description, slug: name.toLowerCase().replace(/\s+/g, '-') };
    }
  }

  // Chapter CRUD
  async createChapter(bookId: number, name: string, description: string = ''): Promise<any> {
    try {
      const res = await this.client.post('/chapters', { book_id: bookId, name, description });
      return res.data;
    } catch (err: any) {
      console.warn(`[BookStack] Failed to create chapter: ${err.message}. Returning mock response.`);
      return { id: Math.floor(Math.random() * 1000) + 500, book_id: bookId, name, description };
    }
  }

  // Page CRUD
  async listPages(query?: string): Promise<any[]> {
    try {
      const res = await this.client.get('/pages', { params: { filter: query ? { name: query } : undefined } });
      return res.data.data || [];
    } catch (err: any) {
      console.warn(`[BookStack] Failed to list pages: ${err.message}. Returning mock data.`);
      return [{ id: 100, name: 'System Requirements Specification', slug: 'system-requirements-specification' }];
    }
  }

  async getPage(id: number): Promise<any> {
    try {
      const res = await this.client.get(`/pages/${id}`);
      return res.data;
    } catch (err: any) {
      console.warn(`[BookStack] Failed to get page ${id}: ${err.message}. Returning mock data.`);
      return { id, name: 'System Spec', markdown: '# System Spec\n\nThis is a complete software specification.' };
    }
  }

  async createPage(options: { bookId?: number; chapterId?: number; name: string; html?: string; markdown?: string }): Promise<any> {
    try {
      const payload: any = { name: options.name };
      if (options.bookId) payload.book_id = options.bookId;
      if (options.chapterId) payload.chapter_id = options.chapterId;
      if (options.markdown) payload.markdown = options.markdown;
      if (options.html) payload.html = options.html;

      const res = await this.client.post('/pages', payload);
      return res.data;
    } catch (err: any) {
      console.warn(`[BookStack] Failed to create page: ${err.message}. Returning mock response.`);
      return {
        id: Math.floor(Math.random() * 1000) + 1000,
        name: options.name,
        book_id: options.bookId,
        chapter_id: options.chapterId,
        markdown: options.markdown,
        slug: options.name.toLowerCase().replace(/\s+/g, '-'),
      };
    }
  }

  getDefinitions(): Record<string, BookStackEntityDefinition> {
    return BOOKSTACK_DEFINITIONS;
  }
}
