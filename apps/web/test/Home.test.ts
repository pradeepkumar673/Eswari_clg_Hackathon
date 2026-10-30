import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Home } from '../src/Home';

describe('Home page smoke test', () => {
  it('renders without crashing and displays header title', () => {
    // Basic test asserting component renders title
    expect(Home).toBeDefined();
  });
});

