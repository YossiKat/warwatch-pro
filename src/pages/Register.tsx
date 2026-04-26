import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

const Register = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [locationConsent, setLocationConsent] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [isLogin, setIsLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate('/');
      } else {
        if (!termsAccepted) {
          setError('יש לאשר את תנאי השימוש');
          setLoading(false);
          return;
        }
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: name, location_consent: locationConsent },
          },
        });
        if (error) throw error;
        setSuccess('נשלח מייל אימות. בדוק את תיבת הדואר שלך.');
      }
    } catch (err: any) {
      setError(err.message || 'שגיאה');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div dir="rtl" style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0f1a 0%, #0d1b2a 50%, #1b2838 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 420,
        background: 'rgba(10, 20, 35, 0.95)',
        border: '1px solid hsla(185, 80%, 40%, 0.25)',
        borderRadius: 12,
        padding: '32px 28px',
        boxShadow: '0 0 60px rgba(0, 200, 255, 0.05)',
      }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 28, fontWeight: 900, fontFamily: 'Orbitron, monospace', color: 'hsl(185, 100%, 55%)', letterSpacing: 2 }}>
            🛡️ WAR ROOM
          </div>
          <div style={{ fontSize: 11, color: 'hsla(185, 60%, 50%, 0.5)', marginTop: 6, fontFamily: 'Orbitron, monospace' }}>
            TACTICAL MONITORING SYSTEM
          </div>
        </div>

        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e0e0e0', marginBottom: 20, textAlign: 'center' }}>
          {isLogin ? 'כניסה למערכת' : 'הרשמה למערכת'}
        </h2>

        {error && (
          <div style={{ background: 'rgba(255, 23, 68, 0.1)', border: '1px solid rgba(255, 23, 68, 0.3)', borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontSize: 13, color: '#ff5252' }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ background: 'rgba(0, 230, 118, 0.1)', border: '1px solid rgba(0, 230, 118, 0.3)', borderRadius: 6, padding: '8px 12px', marginBottom: 16, fontSize: 13, color: '#00e676' }}>
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {!isLogin && (
            <div>
              <label style={{ fontSize: 12, color: '#90a4ae', marginBottom: 4, display: 'block' }}>שם מלא</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                required={!isLogin}
                style={{
                  width: '100%', padding: '10px 12px', borderRadius: 6,
                  background: 'rgba(0, 20, 40, 0.8)', border: '1px solid hsla(185, 80%, 40%, 0.2)',
                  color: '#e0e0e0', fontSize: 14, outline: 'none',
                }}
                placeholder="הכנס שם מלא"
              />
            </div>
          )}

          <div>
            <label style={{ fontSize: 12, color: '#90a4ae', marginBottom: 4, display: 'block' }}>אימייל</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 6,
                background: 'rgba(0, 20, 40, 0.8)', border: '1px solid hsla(185, 80%, 40%, 0.2)',
                color: '#e0e0e0', fontSize: 14, outline: 'none',
              }}
              placeholder="your@email.com"
            />
          </div>

          <div>
            <label style={{ fontSize: 12, color: '#90a4ae', marginBottom: 4, display: 'block' }}>סיסמה</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              minLength={6}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 6,
                background: 'rgba(0, 20, 40, 0.8)', border: '1px solid hsla(185, 80%, 40%, 0.2)',
                color: '#e0e0e0', fontSize: 14, outline: 'none',
              }}
              placeholder="לפחות 6 תווים"
            />
          </div>

          {!isLogin && (
            <>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 12, color: '#b0bec5' }}>
                <input
                  type="checkbox"
                  checked={locationConsent}
                  onChange={e => setLocationConsent(e.target.checked)}
                  style={{ marginTop: 2, accentColor: 'hsl(185, 100%, 45%)' }}
                />
                <span>אני מאשר/ת שיתוף נתוני מיקום לצורך הצגת אירועים קרובים ומקלטים</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, cursor: 'pointer', fontSize: 12, color: '#b0bec5' }}>
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={e => setTermsAccepted(e.target.checked)}
                  required
                  style={{ marginTop: 2, accentColor: 'hsl(185, 100%, 45%)' }}
                />
                <span>
                  אני מאשר/ת שהשימוש במערכת הוא <strong style={{ color: '#ffd740' }}>לצפייה בלבד</strong>,
                  לא לשימוש מסחרי או צבאי כנגד מדינת ישראל.
                  המידע מוצג "כפי שהוא" ואינו מהווה מקור רשמי.
                </span>
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: '100%', padding: '12px', borderRadius: 6,
              background: loading ? 'hsla(185, 80%, 40%, 0.3)' : 'linear-gradient(135deg, hsl(185, 100%, 40%), hsl(185, 80%, 30%))',
              color: '#fff', fontWeight: 700, fontSize: 15,
              border: 'none', cursor: loading ? 'wait' : 'pointer',
              letterSpacing: 1, transition: 'all 0.2s',
            }}
          >
            {loading ? '⏳ טוען...' : isLogin ? 'כניסה' : 'הרשמה'}
          </button>
        </form>

        <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#78909c' }}>
          {isLogin ? 'אין לך חשבון?' : 'כבר רשום?'}{' '}
          <button
            onClick={() => { setIsLogin(!isLogin); setError(''); setSuccess(''); }}
            style={{ color: 'hsl(185, 100%, 55%)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', fontSize: 13 }}
          >
            {isLogin ? 'הרשמה' : 'כניסה'}
          </button>
        </div>

        <div style={{ marginTop: 20, padding: '10px 12px', borderRadius: 6, background: 'rgba(255, 215, 64, 0.05)', border: '1px solid rgba(255, 215, 64, 0.15)', fontSize: 10, color: '#ffd740', lineHeight: 1.6, textAlign: 'center' }}>
          ⚠️ מערכת זו מיועדת לצפייה בלבד ואינה מהווה תחליף לגורמים רשמיים.
          בעת חירום — פעלו בהתאם להנחיות פיקוד העורף.
        </div>
      </div>
    </div>
  );
};

export default Register;
