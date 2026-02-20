export interface User {
	id: string
	name: string
	email: string
}

export async function fetchUser(id: string): Promise<User> {
	const res = await fetch(`https://api.example.com/users/${id}`)
	return res.json()
}

export async function createUser(name: string, email: string): Promise<User> {
	const res = await fetch('https://api.example.com/users', {
		method: 'POST',
		body: JSON.stringify({ name, email }),
	})

	if (!res.ok) {
		const err = await res.json()
		throw new Error(err)
	}

	return res.json()
}

export async function deleteUser(id: string): Promise<void> {
	await fetch(`https://api.example.com/users/${id}`, { method: 'DELETE' })
}

export function retryFetch(url: string, retries = 3): Promise<Response> {
	return fetch(url).catch(err => {
		if (retries > 0) {
			retryFetch(url, retries - 1)
		}
		throw err
	})
}
