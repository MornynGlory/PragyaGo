import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function RiderEditProfileScreen() {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { fetchProfile() }, [])

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (profile) {
        setFullName(profile.full_name ?? '')
        setPhone(profile.phone ?? '')
        setEmail(profile.email ?? user.email ?? '')
      }
    } catch (e) {
      console.error('fetchProfile error:', e)
    }
  }

  const saveProfile = async () => {
    if (!fullName.trim()) {
      Alert.alert('Required', 'Please enter your full name.')
      return
    }
    if (!userId) return
    setSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), email: email.trim() })
        .eq('id', userId)
      if (error) { Alert.alert('Error', error.message); return }
      Alert.alert('Success', 'Profile updated successfully!')
      router.back()
    } catch {
      Alert.alert('Error', 'Could not save profile. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const initials = fullName.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?'

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Edit Profile</Text>
        <TouchableOpacity onPress={saveProfile} style={styles.headerBtn} disabled={saving} activeOpacity={0.7}>
          <Text style={[styles.saveText, saving && styles.saveTextDisabled]}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            <Text style={styles.initials}>{initials}</Text>
          </View>
        </View>

        {/* Form */}
        <View style={styles.formSection}>
          {/* Full Name */}
          <Text style={styles.fieldLabel}>Full Name</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={fullName}
              onChangeText={setFullName}
              placeholder="Your full name"
              placeholderTextColor={theme.placeholder}
              autoCapitalize="words"
            />
          </View>

          {/* Phone - read only */}
          <Text style={styles.fieldLabel}>Phone Number</Text>
          <View style={[styles.inputRow, styles.inputRowLocked]}>
            <TextInput
              style={[styles.input, styles.inputLocked]}
              value={phone}
              editable={false}
              placeholderTextColor={theme.placeholder}
            />
            <Feather name="lock" size={16} color={theme.textMuted} style={styles.lockIcon} />
          </View>
          <Text style={styles.lockedNote}>Contact support to change your phone number</Text>

          {/* Email */}
          <Text style={styles.fieldLabel}>Email</Text>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Your email address"
              placeholderTextColor={theme.placeholder}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
        </View>

        {/* Save button */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={saveProfile}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={styles.saveButtonText}>{saving ? 'Saving...' : 'Save Changes'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  )
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: c.border, backgroundColor: c.background },
    headerBtn: { width: 48, height: 40, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 17, fontWeight: '700', color: c.text },
    saveText: { fontSize: 15, fontWeight: '600', color: c.green },
    saveTextDisabled: { opacity: 0.4 },
    scrollContent: { paddingBottom: 40 },
    avatarSection: { alignItems: 'center', paddingVertical: 28, backgroundColor: c.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    avatarCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: c.green, justifyContent: 'center', alignItems: 'center' },
    initials: { fontSize: 28, fontWeight: '700', color: '#fff' },
    formSection: { backgroundColor: c.card, marginHorizontal: 16, marginTop: 20, borderRadius: 14, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6, marginTop: 14 },
    inputRow: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12, backgroundColor: c.input },
    inputRowLocked: { opacity: 0.6 },
    input: { flex: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, color: c.text },
    inputLocked: { color: c.textSecondary },
    lockIcon: { paddingRight: 14 },
    lockedNote: { fontSize: 11, color: c.textMuted, marginTop: 4 },
    saveButton: { margin: 16, marginTop: 24, backgroundColor: c.green, paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
    saveButtonDisabled: { opacity: 0.6 },
    saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  })
}
