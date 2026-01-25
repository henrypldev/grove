import { View, Text, Pressable, FlatList, Alert } from 'react-native'
import { Link } from 'expo-router'
import { StyleSheet } from 'react-native-unistyles'
import { useEffect, useState } from 'react'
import { api, Repo } from '@/services/api'

export default function ReposScreen() {
  const [repos, setRepos] = useState<Repo[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadRepos()
  }, [])

  const loadRepos = async () => {
    try {
      const data = await api.getRepos()
      setRepos(data)
    } catch (e) {
      console.error('Failed to load repos:', e)
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = (repo: Repo) => {
    Alert.alert('Remove Repo', `Remove ${repo.name} from Klaude?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteRepo(repo.id)
            setRepos(repos.filter((r) => r.id !== repo.id))
          } catch (e) {
            console.error('Failed to delete repo:', e)
          }
        },
      },
    ])
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={repos}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyText}>
              {loading ? 'Loading...' : 'No repos added'}
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            style={styles.repoItem}
            onLongPress={() => handleDelete(item)}
          >
            <Text style={styles.repoName}>{item.name}</Text>
            <Text style={styles.repoPath}>{item.path}</Text>
          </Pressable>
        )}
      />
      <View style={styles.footer}>
        <Link href="/repos/add" asChild>
          <Pressable style={styles.button}>
            <Text style={styles.buttonText}>[ ADD REPO ]</Text>
          </Pressable>
        </Link>
      </View>
    </View>
  )
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  list: {
    padding: theme.spacing(4),
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: theme.spacing(20),
  },
  emptyText: {
    color: theme.colors.textDim,
    fontFamily: theme.fonts.mono,
    fontSize: 14,
  },
  repoItem: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    marginBottom: theme.spacing(2),
  },
  repoName: {
    color: theme.colors.text,
    fontFamily: theme.fonts.mono,
    fontSize: 16,
  },
  repoPath: {
    color: theme.colors.textDim,
    fontFamily: theme.fonts.mono,
    fontSize: 12,
    marginTop: theme.spacing(1),
  },
  footer: {
    padding: theme.spacing(4),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  button: {
    borderWidth: 1,
    borderColor: theme.colors.text,
    padding: theme.spacing(4),
    alignItems: 'center',
  },
  buttonText: {
    color: theme.colors.text,
    fontFamily: theme.fonts.mono,
    fontSize: 14,
  },
}))
