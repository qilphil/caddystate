export function requireLogin(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

export function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    req.session.returnTo = req.originalUrl;
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
    return res.status(403).render('error', {
      title: 'Forbidden',
      message: 'Admin access required.',
      user: req.session.user,
    });
  }
  next();
}
