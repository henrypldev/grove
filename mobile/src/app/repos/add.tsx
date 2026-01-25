import { View, Text, Pressable, TextInput, Alert } from 'react-native'
import { router } from 'expo-router'
import { StyleSheet } from 'react-native-unistyles'
import { useState } from 'react'
import { api } from '@/services/api'

export default function AddRepoScreen() {
  const [path, setPath] = useState('')
  const [loading, setLoading] = useState(false)

  const handleAdd = async () => {
    if (!path.trim()) return
    setLoading(true)
    try {
      await api.addRepo(path.trim())
      router.back()
    } catch (e) {
      Alert.alert('Error', 'Failed to add repo. Make sure the path is valid.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Repository Path</Text>
      <TextInput
        style={styles.input}
        value={path}
        onChangeText={setPath}
        placeholder="/Users/you/Projects/your-repo"
        placeholderTextColor="#888888"
        autoCapitalize="none"
        autoCorrect={false}
        autoFocus
      />
      <Text style={styles.hint}>
        Enter the full path to a git repository on your laptop.
      </Text>
      <Pressable
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleAdd}
        disabled={loading}
      >
        <Text style={styles.buttonText}>
          {loading ? '[ ADDING... ]' : '[ ADD ]'}
        </Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing(4),
  },
  label: {
    color: theme.colors.textDim,
    fontFamily: theme.fonts.mono,
    fontSize: 12,
    marginBottom: theme.spacing(2),
  },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
    color: theme.colors.text,
    fontFamily: theme.fonts.mono,
    fontSize: 14,
  },
  hint: {
    color: theme.colors.textDim,
    fontFamily: theme.fonts.mono,
    fontSize: 11,
    marginTop: theme.spacing(2),
  },
  button: {
    borderWidth: 1,
    borderColor: theme.colors.text,
    padding: theme.spacing(4),
    alignItems: 'center',
    marginTop: theme.spacing(6),
  },
  buttonDisabled: {
    borderColor: theme.colors.border,
  },
  buttonText: {
    color: theme.colors.text,
    fontFamily: theme.fonts.mono,
    fontSize: 14,
  },
}))
