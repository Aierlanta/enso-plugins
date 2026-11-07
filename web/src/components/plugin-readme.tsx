import * as React from 'react';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Skeleton } from '@/components/ui/skeleton';

type State = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error' };

// 包内相对路径的截图没有发布，CSP 也只放行同源图片
const loadable = (src: unknown) => typeof src === 'string' && (src.startsWith('data:') || src.startsWith('/v1/'));

const components: Components = {
  h1: ({ children }) => <h3 className="mt-5 text-base font-semibold first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mt-5 text-sm font-semibold first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mt-4 text-sm font-medium first:mt-0">{children}</h5>,
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  a: ({ href, children }) =>
    /^https?:\/\//.test(href ?? '') ? (
      <a href={href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
        {children}
      </a>
    ) : (
      <>{children}</>
    ),
  img: ({ src, alt }) => (loadable(src) ? <img src={src as string} alt={alt ?? ''} className="my-2 max-w-full rounded-md" /> : null),
  code: ({ className, children }) =>
    className ? (
      <code className={className}>{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">{children}</code>
    ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs [&_code]:bg-transparent [&_code]:p-0">{children}</pre>
  ),
  blockquote: ({ children }) => <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>,
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b px-2 py-1.5 font-medium">{children}</th>,
  td: ({ children }) => <td className="border-b px-2 py-1.5 align-top">{children}</td>,
};

export default function PluginReadme({ url }: { url: string }) {
  const [state, setState] = React.useState<State>({ status: 'loading' });
  React.useEffect(() => {
    let alive = true;
    setState({ status: 'loading' });
    fetch(url)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((text) => alive && setState({ status: 'ready', text: text.replace(/^\s*#\s[^\n]*\n/, '') }))
      .catch(() => alive && setState({ status: 'error' }));
    return () => {
      alive = false;
    };
  }, [url]);

  if (state.status === 'loading') return <Skeleton className="h-24 w-full" />;
  if (state.status === 'error') return <p className="text-sm text-muted-foreground">使用说明加载失败，稍后再试。</p>;
  return (
    <div className="text-sm">
      <Markdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {state.text}
      </Markdown>
    </div>
  );
}
