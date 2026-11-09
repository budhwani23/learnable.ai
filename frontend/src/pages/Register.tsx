import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Eye, EyeOff, Mail, Lock, User as UserIcon } from 'lucide-react';
import Header from '@/components/Header';
import RoleToggle from '@/components/RoleToggle';
import { parseRole, ROLE_COPY } from '@/lib/roles';
import type { Role } from '@/lib/types';

export default function Register() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const params = useParams<{ role?: string }>();
  const role = parseRole(params.role ?? new URLSearchParams(search).get('role'));
  const copy = ROLE_COPY[role];
  // Same rule as the sign-in page: only same-site paths.
  const requested = new URLSearchParams(search).get('redirect') || '';
  const redirect = requested.startsWith('/') && !requested.startsWith('//') ? requested : '/input';
  const { register } = useAuth();

  const switchRole = (r: Role) => {
    setError('');
    navigate({ pathname: `/register/${r}`, search }, { replace: true });
  };

  const [username, setU] = useState('');
  const [email, setE] = useState('');
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
      await register(username, email, password, role);
      navigate(redirect, { replace: true });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : 'Registration failed');
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

            <div className="text-center mb-5">
              <h1 className="text-2xl font-semibold text-green-700">{copy.signUp}</h1>
              <p className="mt-2 text-sm text-gray-600">{copy.signUpBlurb}</p>
            </div>

            <RoleToggle role={role} onChange={switchRole} />

            <form onSubmit={onSubmit} className="space-y-4">
              {error && <div className="text-red-600 text-sm bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

              {/* Username */}
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  placeholder="Username"
                  value={username}
                  onChange={e => setU(e.target.value)}
                  className="pl-10 h-11 rounded-lg"
                />
              </div>

              {/* Email */}
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <Input
                  placeholder="Email"
                  value={email}
                  onChange={e => setE(e.target.value)}
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

              <Button type="submit" className="w-full h-11 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white shadow-md" disabled={loading}>
                {loading ? 'Creating account…' : `Create ${role} account`}
              </Button>

              <div className="text-sm text-center text-gray-600">
                Already have a {role} account?{' '}
                <Link to={`/login/${role}${search}`} className="text-emerald-600 hover:underline">Sign in</Link>
              </div>
            </form>
          </Card>

          <div className="text-center mt-6 text-xs text-gray-500">
            By signing up, you agree to our Terms and Privacy Policy.
          </div>
        </div>
      </div>
    </>
  );
} 