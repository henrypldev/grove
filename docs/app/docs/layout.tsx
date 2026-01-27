import { DocsLayout } from 'fumadocs-ui/layouts/docs'
import type { ReactNode } from 'react'
import { source } from '@/lib/source'

export default function Layout({ children }: { children: ReactNode }) {
	return (
		<DocsLayout
			tree={source.getPageTree()}
			nav={{
				title: 'Grove',
				url: '/docs',
			}}
			links={[{ text: 'GitHub', url: 'https://github.com/henrypldev/grove' }]}
		>
			{children}
		</DocsLayout>
	)
}
