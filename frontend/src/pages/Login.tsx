import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
import Header from '@/components/Header';

export default function Login() {
  const navigate = useNavigate();
  // Honour ?redirect=/r/<id> (shared class links); only same-site paths, never "//host".
  const requested = new URLSearchParams(window.location.search).get('redirect') || '';
  const redirect = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/input';
  const { login } = useAuth();

  const [username, setU] = useState('');
  const [password, setP] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false); // Toggle visibility

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      await login(username, password);
      navigate(redirect, { replace: true });
    } catch {
      setError('Invalid credentials');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <div className="bg-green-50 flex items-center justify-center px-4 min-h-[calc(100vh-64px)]">
        <div className="max-w-md w-full">
          <Card className="relative p-6 pt-12 border-0 shadow-xl rounded-2xl">
            {/* Floating logo on card header */}
            <div className="absolute -top-6 left-1/2 -translate-x-1/2">
              <div className="rounded-2xl bg-white p-2 shadow-md ring-1 ring-green-100">
                <img
                  src="/hopenote-logo.png"
                  alt="hopenote logo"
                  className="h-10 w-10 rounded-xl"
                />
              </div>
            </div>

            <div className="text-center mb-6">
              <h1 className="text-2xl font-semibold text-emerald-700">Welcome back to HopNote!</h1>
              <p className="mt-2 text-sm text-gray-600">Login to bring your words, data, and teams together. For free</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4">
              {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

              {/* Email / Username */}
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  placeholder="Username"
                  value={username}
                  onChange={e => setU(e.target.value)}
                  className="pl-10 h-11 rounded-lg"
                />
              </div>

              {/* Password */}
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={e => setP(e.target.value)}
                  className="pl-10 pr-10 h-11 rounded-lg"
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  onClick={() => setShowPassword(v => !v)}
                  className="absolute inset-y-0 right-3 my-auto text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>

              <div className="flex items-center justify-end">
                <button type="button" className="text-sm text-gray-600 hover:text-green-700">
                  Forgot password?
                </button>
              </div>

              <Button type="submit" className="w-full h-11 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-md" disabled={loading}>
                {loading ? 'Signing in…' : 'Get Started'}
              </Button>



              <div className="text-sm text-center text-gray-600">
                Don’t have an account?{' '}
                <Link to="/register" className="text-emerald-600 hover:underline">Create one</Link>
              </div>
            </form>
          </Card>

          <div className="text-center mt-6 text-xs text-gray-500">
            By continuing, you agree to our Terms and Privacy Policy.
          </div>
        </div>
      </div>
    </>
  );
} 