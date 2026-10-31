import { test, expect } from '@playwright/test'

const unique = () => `e2e-${Date.now()}-${Math.floor(Math.random() * 10000)}`

async function register(page: import('@playwright/test').Page) {
  const email = `${unique()}@test.dev`
  await page.goto('/register')
  await page.getByLabel('Name').fill('E2E Candidate')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password (min 8 characters)').fill('password123')
  await page.getByRole('button', { name: 'Register' }).click()
  await expect(page.getByRole('heading', { name: 'Practice interview' })).toBeVisible()
  return email
}

test('register → consent gate → session with questions (T3, T14)', async ({ page }) => {
  await register(page)

  // T14: start button disabled until consent is checked
  await page.getByLabel('What job role are you practicing for?').fill('sales representative')
  const startButton = page.getByRole('button', { name: 'Start session' })
  await expect(startButton).toBeDisabled()

  await page.getByText('I understand and consent').click()
  await expect(startButton).toBeEnabled()
  await startButton.click()

  // Session page asks for camera permissions
  await expect(page.getByRole('button', { name: 'Enable camera & microphone' })).toBeVisible()
})

test('T1: fake camera grants permission and preview appears', async ({ page }) => {
  await register(page)
  await page.getByLabel('What job role are you practicing for?').fill('teacher')
  await page.getByText('I understand and consent').click()
  await page.getByRole('button', { name: 'Start session' }).click()

  await page.getByRole('button', { name: 'Enable camera & microphone' }).click()

  // Fake device streams into the <video>; models load next (may take a while on first run)
  await expect(page.locator('video.preview')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Begin interview' })).toBeVisible({
    timeout: 45_000,
  })
})

test('login rejects wrong password', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('nobody@test.dev')
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Log in' }).click()
  await expect(page.getByText('Invalid credentials')).toBeVisible()
})

test('session history empty state (T13)', async ({ page }) => {
  await register(page)
  await page.goto('/history')
  await expect(page.getByText('No sessions yet.')).toBeVisible()
})
