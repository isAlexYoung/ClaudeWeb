import { createContext } from 'react';

/** Markdown's code renderer uses the normalized source to distinguish closed fences from streamed partial blocks. */
export const MarkdownSourceContext = createContext('');
