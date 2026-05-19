import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Loader2, MailCheck, ShieldCheck, Smartphone, Zap } from 'lucide-react';

import { authService, type AuthResponse, type VerificationPendingResponse } from '@/services/auth.service';
import { useAuthStore } from '@/store/authStore';
import { getApiErrorMessage } from '@/lib/axios';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

type RegisterFormState = {
  name: string;
  email: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
};

type PendingVerificationState = {
  email: string;
  devOtpPreview?: string;
};

export default function Register() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [formData, setFormData] = useState<RegisterFormState>({
    name: '',
    email: '',
    phoneNumber: '',
    password: '',
    confirmPassword: '',
  });
  const [otp, setOtp] = useState('');
  const [pendingVerification, setPendingVerification] = useState<PendingVerificationState | null>(null);

  const registerMutation = useMutation({
    mutationFn: authService.register,
    onSuccess: (data: AuthResponse | VerificationPendingResponse) => {
      if ('requiresVerification' in data && data.requiresVerification) {
        setPendingVerification({
          email: data.email,
          devOtpPreview: data.devOtpPreview,
        });
        toast.success('Verification code sent to your email.');
        return;
      }

      setAuth(data.user, data.token);
      toast.success('Account created successfully!');
      navigate('/');
    },
    onError: (error: unknown) => {
      console.error('Registration request failed:', error);
      toast.error(getApiErrorMessage(error, 'Registration failed'));
    },
  });

  const verifyMutation = useMutation({
    mutationFn: authService.verifyEmailOtp,
    onSuccess: (data) => {
      setAuth(data.user, data.token);
      toast.success('Email verified successfully!');
      navigate('/');
    },
    onError: (error: unknown) => {
      console.error('OTP verification failed:', error);
      toast.error(getApiErrorMessage(error, 'Verification failed'));
    },
  });

  const resendMutation = useMutation({
    mutationFn: authService.resendEmailOtp,
    onSuccess: (data) => {
      setPendingVerification((current) =>
        current
          ? {
              ...current,
              devOtpPreview: data.devOtpPreview,
            }
          : current
      );
      toast.success(data.message || 'A new code has been sent.');
    },
    onError: (error: unknown) => {
      console.error('OTP resend failed:', error);
      toast.error(getApiErrorMessage(error, 'Could not resend verification code'));
    },
  });

  const handleRegisterSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (formData.password !== formData.confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    registerMutation.mutate({
      name: formData.name,
      email: formData.email,
      phoneNumber: formData.phoneNumber,
      password: formData.password,
    });
  };

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingVerification) return;

    verifyMutation.mutate({
      email: pendingVerification.email,
      otp,
    });
  };

  return (
    <div className="min-h-screen overflow-hidden bg-gradient-to-br from-background via-background to-accent/5 p-4 sm:p-6">
      <div className="mx-auto grid min-h-[calc(100vh-2rem)] w-full max-w-6xl items-center gap-8 lg:grid-cols-[1.08fr_0.92fr] xl:gap-12">
        <section className="hidden md:block">
          <div className="max-w-xl">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-3xl bg-gradient-primary shadow-large sm:h-16 sm:w-16">
              <Zap className="h-8 w-8 text-white" />
            </div>
            <h1 className="mt-8 text-4xl font-bold leading-tight lg:text-5xl">
              Create a verified account with a clean, modern onboarding flow.
            </h1>
            <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground lg:text-lg lg:leading-8">
              Register with your name, email, and phone number, then confirm ownership with a one-time code sent to
              your inbox.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              <div className="utility-panel p-4">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <p className="mt-3 font-semibold">Verified identity</p>
              </div>
              <div className="utility-panel p-4">
                <Smartphone className="h-5 w-5 text-primary" />
                <p className="mt-3 font-semibold">Phone on file</p>
              </div>
              <div className="utility-panel p-4">
                <MailCheck className="h-5 w-5 text-primary" />
                <p className="mt-3 font-semibold">Email OTP protection</p>
              </div>
            </div>
          </div>
        </section>

        <div className="w-full max-w-md justify-self-center animate-fade-in md:max-w-lg lg:max-w-md">
          <div className="mb-8 text-center md:hidden">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary shadow-large">
              <Zap className="h-8 w-8 text-white" />
            </div>
            <h1 className="mt-4 text-3xl font-bold">PowerTrack</h1>
            <p className="mt-2 text-muted-foreground">Create your account with secure email verification</p>
          </div>

          <Card className="utility-panel-strong border-border shadow-large">
            <CardHeader className="space-y-2 p-6 sm:p-8">
              <CardTitle className="text-2xl sm:text-3xl">{pendingVerification ? 'Verify your email' : 'Create account'}</CardTitle>
              <CardDescription className="text-sm sm:text-base">
                {pendingVerification
                  ? `Enter the 6-digit code sent to ${pendingVerification.email}.`
                  : 'Set up your account with your name, email, phone number, and password.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6 pt-0 sm:p-8 sm:pt-0">
              {!pendingVerification ? (
                <form onSubmit={handleRegisterSubmit} className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="name">Full name</Label>
                    <Input
                      id="name"
                      type="text"
                      placeholder="John Doe"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@example.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="phoneNumber">Phone number</Label>
                    <Input
                      id="phoneNumber"
                      type="tel"
                      placeholder="+92 300 1234567"
                      value={formData.phoneNumber}
                      onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                      required
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Create a strong password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      required
                      minLength={8}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm password</Label>
                    <Input
                      id="confirmPassword"
                      type="password"
                      placeholder="Repeat your password"
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                      required
                      minLength={8}
                    />
                  </div>

                  <Button
                    type="submit"
                    className="mt-2 h-11 w-full bg-gradient-primary text-base hover:opacity-90"
                    disabled={registerMutation.isPending}
                  >
                    {registerMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Sending verification code...
                      </>
                    ) : (
                      'Continue to verification'
                    )}
                  </Button>

                  <p className="text-center text-sm text-muted-foreground">
                    Already have an account?{' '}
                    <Link to="/login" className="font-medium text-primary hover:underline">
                      Sign in
                    </Link>
                  </p>
                </form>
              ) : (
                <form onSubmit={handleVerifySubmit} className="space-y-5">
                  <div className="rounded-lg border border-border bg-secondary/40 p-4 text-sm text-muted-foreground">
                    Check your inbox for the verification code. It expires in 10 minutes.
                    {import.meta.env.DEV && pendingVerification.devOtpPreview && (
                      <p className="mt-3 text-primary">
                        Dev preview code: <span className="font-semibold">{pendingVerification.devOtpPreview}</span>
                      </p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <Label htmlFor="otp">Verification code</Label>
                    <InputOTP
                      id="otp"
                      maxLength={6}
                      value={otp}
                      onChange={setOtp}
                      containerClassName="justify-center gap-1.5 sm:gap-2"
                    >
                      <InputOTPGroup>
                        {Array.from({ length: 6 }).map((_, index) => (
                          <InputOTPSlot
                            key={index}
                            index={index}
                            className="h-11 w-10 bg-background text-base sm:h-12 sm:w-12"
                          />
                        ))}
                      </InputOTPGroup>
                    </InputOTP>
                  </div>

                  <Button
                    type="submit"
                    className="h-11 w-full bg-gradient-primary text-base hover:opacity-90"
                    disabled={verifyMutation.isPending || otp.length !== 6}
                  >
                    {verifyMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying code...
                      </>
                    ) : (
                      'Verify and create account'
                    )}
                  </Button>

                  <div className="flex flex-col gap-3 sm:flex-row">
                    <Button
                      type="button"
                      variant="outline"
                      className="h-11 flex-1"
                      disabled={resendMutation.isPending}
                      onClick={() => resendMutation.mutate(pendingVerification.email)}
                    >
                      {resendMutation.isPending ? 'Resending...' : 'Resend code'}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-11 flex-1"
                      onClick={() => {
                        setPendingVerification(null);
                        setOtp('');
                      }}
                    >
                      Edit details
                    </Button>
                  </div>

                  <p className="text-center text-sm text-muted-foreground">
                    Already verified?{' '}
                    <Link to="/login" className="font-medium text-primary hover:underline">
                      Sign in
                    </Link>
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
