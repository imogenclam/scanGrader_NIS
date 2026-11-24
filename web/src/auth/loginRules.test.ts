// запуск: node --test src/features/auth/loginRules.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginFix, loginProblem } from '../features/auth/loginRules.ts'

test('пробел объясняем отдельно и чиним подчёркиванием', () => {
  assert.match(loginProblem('Иванова Мария') ?? '', /Пробел/)
  assert.equal(loginFix('Иванова Мария'), 'Иванова_Мария')
})

test('почту в поле логина объясняем и предлагаем начало адреса', () => {
  assert.match(loginProblem('masha@mail.ru') ?? '', /почту/)
  assert.equal(loginFix('masha@mail.ru'), 'masha')
})

test('нормальный логин без замечаний', () => {
  assert.equal(loginProblem('ivanova.m'), null)
  assert.equal(loginProblem('Маша_2'), null)
  assert.equal(loginProblem(''), null)
})

test('прочие символы и длина', () => {
  assert.match(loginProblem('a+b') ?? '', /только буквы/)
  assert.match(loginProblem('ab') ?? '', /не короче/)
  assert.match(loginProblem('x'.repeat(31)) ?? '', /не длиннее/)
  assert.equal(loginFix('a+b!c'), 'abc')
})
